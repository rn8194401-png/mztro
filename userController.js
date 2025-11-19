const { User, Plan, Transaction, SystemConfig } = require('./models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 1. Registro de Usuário (COM REGISTRO DE BÔNUS NO HISTÓRICO)
exports.register = async (req, res) => {
    try {
        const { name, phone, password, referralId } = req.body;

        // Validar 9 dígitos
        if (!/^\d{9}$/.test(phone)) {
            return res.status(400).json({ msg: 'O número deve ter exatamente 9 dígitos.' });
        }

        // Verificar se já existe
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ msg: 'Número já cadastrado.' });

        // Hash da senha
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Verificar Bônus de Boas-vindas
        const config = await SystemConfig.findOne();
        const bonus = config ? (config.welcomeBonus || 0) : 0;

        // Criar usuário
        const newUser = new User({
            name,
            phone,
            password: hashedPassword,
            referrer: referralId || null,
            balance: bonus 
        });

        await newUser.save();

        // REGISTRA O BÔNUS NO HISTÓRICO (SE HOUVER)
        if (bonus > 0) {
            await Transaction.create({
                user: newUser._id,
                type: 'bonus',
                amount: bonus,
                status: 'approved',
                adminComment: 'Bônus de Boas-vindas'
            });
        }
        
        res.status(201).json({ msg: 'Conta criada com sucesso! Faça login.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Login
exports.login = async (req, res) => {
    try {
        const { phone, password } = req.body;

        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ msg: 'Usuário não encontrado.' });

        if (!user.isActive) return res.status(403).json({ msg: 'Conta bloqueada.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Senha incorreta.' });

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                phone: user.phone,
                role: user.role
            }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. Obter Perfil e Dashboard
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password')
            .populate('plan')
            .populate('referrer', 'name phone');
        
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';

        res.json({ user, frontendUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 4. Solicitar Depósito
exports.deposit = async (req, res) => {
    try {
        const { amount, senderPhone } = req.body;
        
        if (!req.file) return res.status(400).json({ msg: 'Comprovante é obrigatório.' });
        if (!senderPhone) return res.status(400).json({ msg: 'Informe o número que fez a transferência.' });

        await Transaction.create({
            user: req.user.id,
            type: 'deposit',
            amount: Number(amount),
            senderPhone: senderPhone,
            proofImage: req.file.path,
            status: 'pending'
        });

        res.json({ msg: 'Depósito enviado para análise.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 5. Solicitar Saque
exports.withdraw = async (req, res) => {
    try {
        const { amount, destinationName, destinationPhone } = req.body;
        const user = await User.findById(req.user.id).populate('plan');
        
        if (!user.plan) return res.status(400).json({ msg: 'Você precisa de um plano VIP para sacar.' });

        if (amount < user.plan.minWithdraw || amount > user.plan.maxWithdraw) {
            return res.status(400).json({ msg: `Saque permitido entre ${user.plan.minWithdraw} e ${user.plan.maxWithdraw} MT.` });
        }

        if (user.balance < amount) return res.status(400).json({ msg: 'Saldo insuficiente.' });

        user.balance -= Number(amount);
        await user.save();

        await Transaction.create({
            user: req.user.id,
            type: 'withdrawal',
            amount: Number(amount),
            destinationName: destinationName,
            destinationPhone: destinationPhone,
            status: 'pending'
        });

        res.json({ msg: 'Solicitação de saque realizada.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 6. Coletar Lucros (COM HISTÓRICO DETALHADO E FROM_USER)
exports.collectDailyIncome = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('plan');

        if (!user.plan) return res.status(400).json({ msg: 'Nenhum plano ativo.' });

        const now = new Date();
        const lastCollection = user.lastDailyCollection ? new Date(user.lastDailyCollection) : null;

        const isSameDay = lastCollection && 
            now.getDate() === lastCollection.getDate() && 
            now.getMonth() === lastCollection.getMonth() && 
            now.getFullYear() === lastCollection.getFullYear();

        if (isSameDay) return res.status(400).json({ msg: 'Você já coletou seu lucro hoje.' });

        // 1. Adiciona saldo e atualiza data
        user.balance += user.plan.dailyIncome;
        user.lastDailyCollection = now;
        await user.save();

        // 2. CRIA HISTÓRICO: Lucro Diário
        await Transaction.create({
            user: user._id,
            type: 'daily',
            amount: user.plan.dailyIncome,
            status: 'approved',
            adminComment: `Rendimento diário (${user.plan.name})`
        });
        
        // 3. Lógica de Recompensa Recorrente para o Líder (Opcional)
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            const reward = config?.affiliateSettings?.recurringReward || 0;
            
            if (reward > 0) {
                const referrer = await User.findById(user.referrer);
                if (referrer) {
                    referrer.balance += reward;
                    referrer.totalCommission += reward;
                    await referrer.save();

                    // REGISTRO DE COMISSÃO RECORRENTE
                    await Transaction.create({
                        user: referrer._id,
                        type: 'commission',
                        amount: reward,
                        status: 'approved',
                        fromUser: user.phone, // Importante: Salva quem gerou o ganho
                        adminComment: 'Bônus recorrente de equipe'
                    });
                }
            }
        }

        res.json({ msg: `Lucro de ${user.plan.dailyIncome} MT coletado!`, newBalance: user.balance });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 7. Comprar Plano (COM HISTÓRICO DE COMISSÃO)
exports.buyPlan = async (req, res) => {
    try {
        const { planId } = req.body;
        const user = await User.findById(req.user.id);
        const plan = await Plan.findById(planId);

        if (!plan) return res.status(404).json({ msg: 'Plano não encontrado.' });
        if (user.balance < plan.price) return res.status(400).json({ msg: 'Saldo insuficiente.' });

        // Compra
        user.balance -= plan.price;
        user.plan = plan._id;
        user.planStartDate = new Date();
        await user.save();
        
        // Comissão para o Líder
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            const percent = config?.affiliateSettings?.commissionPercent || 0;
            const commission = (plan.price * percent) / 100;
            
            if (commission > 0) {
                const referrer = await User.findById(user.referrer);
                if (referrer) {
                    referrer.balance += commission;
                    referrer.totalCommission += commission;
                    await referrer.save();

                    // REGISTRO DA COMISSÃO POR COMPRA
                    await Transaction.create({
                        user: referrer._id,
                        type: 'commission',
                        amount: commission,
                        status: 'approved',
                        fromUser: user.phone, // Quem comprou o plano
                        adminComment: `Comissão de ${percent}% (Plano ${plan.name})`
                    });
                }
            }
        }

        res.json({ msg: `Plano ${plan.name} ativado!` });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 8. Histórico do Usuário
exports.getHistory = async (req, res) => {
    try {
        const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 9. Criar Admin Manualmente (Use via rota /setup-admin)
exports.createAdminManually = async (req, res) => {
    try {
        const phone = '840000000';
        const password = 'admin123';
        
        let user = await User.findOne({ phone });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        if (user) {
            user.password = hashedPassword;
            user.role = 'admin';
            user.isActive = true;
            await user.save();
            return res.json({ msg: 'Usuário atualizado para ADMIN!' });
        }

        const newAdmin = new User({
            name: 'Super Admin',
            phone: phone,
            password: hashedPassword,
            role: 'admin',
            isActive: true,
            balance: 0
        });

        await newAdmin.save();
        res.json({ msg: 'ADMIN criado com sucesso!' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};