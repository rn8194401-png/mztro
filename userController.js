const { User, Plan, Transaction, SystemConfig } = require('./models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 1. Registro de Usuário (COM BÔNUS)
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

        // Verificar se existe Bônus de Boas-vindas configurado
        const config = await SystemConfig.findOne();
        const bonus = config ? (config.welcomeBonus || 0) : 0;

        // Criar usuário (já com o saldo do bônus se houver)
        const newUser = new User({
            name,
            phone,
            password: hashedPassword,
            referrer: referralId || null,
            balance: bonus 
        });

        await newUser.save();

        // Se ganhou bônus, registra no histórico como "bonus"
        if (bonus > 0) {
            const bonusTransaction = new Transaction({
                user: newUser._id,
                type: 'bonus',
                amount: bonus,
                status: 'approved',
                adminComment: 'Bônus de Boas-vindas'
            });
            await bonusTransaction.save();
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

// 3. Obter Perfil e Dashboard (COM FRONTEND URL)
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password')
            .populate('plan')
            .populate('referrer', 'name phone');
        
        // Envia a URL do frontend para o link de convite
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';

        res.json({ user, frontendUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 4. Solicitar Depósito (COM NÚMERO DO REMETENTE)
exports.deposit = async (req, res) => {
    try {
        const { amount, senderPhone } = req.body;
        
        // O arquivo vem do middleware multer (req.file)
        if (!req.file) return res.status(400).json({ msg: 'Comprovante é obrigatório.' });
        if (!senderPhone) return res.status(400).json({ msg: 'Informe o número que fez a transferência.' });

        const newTransaction = new Transaction({
            user: req.user.id,
            type: 'deposit',
            amount: Number(amount),
            senderPhone: senderPhone, // Salva quem enviou
            proofImage: req.file.path,
            status: 'pending'
        });

        await newTransaction.save();
        res.json({ msg: 'Depósito enviado para análise.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 5. Solicitar Saque (COM NOME E NÚMERO DE DESTINO)
exports.withdraw = async (req, res) => {
    try {
        const { amount, destinationName, destinationPhone } = req.body;
        const user = await User.findById(req.user.id).populate('plan');
        
        if (!user.plan) return res.status(400).json({ msg: 'Você precisa de um plano VIP para sacar.' });

        // Validações de limites do plano
        if (amount < user.plan.minWithdraw || amount > user.plan.maxWithdraw) {
            return res.status(400).json({ msg: `Saque permitido entre ${user.plan.minWithdraw} e ${user.plan.maxWithdraw} MT.` });
        }

        if (user.balance < amount) return res.status(400).json({ msg: 'Saldo insuficiente.' });

        // Deduz saldo imediatamente
        user.balance -= Number(amount);
        await user.save();

        const newTransaction = new Transaction({
            user: req.user.id,
            type: 'withdrawal',
            amount: Number(amount),
            destinationName: destinationName,   // Nome do titular
            destinationPhone: destinationPhone, // Número da conta
            status: 'pending'
        });

        await newTransaction.save();
        res.json({ msg: 'Solicitação de saque realizada.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 6. Tarefa Diária: Coletar Lucros
exports.collectDailyIncome = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('plan');

        if (!user.plan) return res.status(400).json({ msg: 'Nenhum plano ativo.' });

        const now = new Date();
        const lastCollection = user.lastDailyCollection ? new Date(user.lastDailyCollection) : null;

        // Verifica se já se passaram 24h (mesmo dia)
        const isSameDay = lastCollection && 
            now.getDate() === lastCollection.getDate() && 
            now.getMonth() === lastCollection.getMonth() && 
            now.getFullYear() === lastCollection.getFullYear();

        if (isSameDay) {
            return res.status(400).json({ msg: 'Você já coletou seu lucro hoje. Volte amanhã.' });
        }

        // Adicionar lucro ao saldo
        user.balance += user.plan.dailyIncome;
        user.lastDailyCollection = now;
        
        // Lógica de Afiliados (Recorrência)
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            const reward = config?.affiliateSettings?.recurringReward || 0;
            if (reward > 0) {
                const referrer = await User.findById(user.referrer);
                if (referrer) {
                    referrer.balance += reward;
                    referrer.totalCommission += reward;
                    await referrer.save();
                }
            }
        }

        await user.save();
        res.json({ msg: `Lucro de ${user.plan.dailyIncome} MT coletado com sucesso!`, newBalance: user.balance });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 7. Comprar Plano
exports.buyPlan = async (req, res) => {
    try {
        const { planId } = req.body;
        const user = await User.findById(req.user.id);
        const plan = await Plan.findById(planId);

        if (!plan) return res.status(404).json({ msg: 'Plano não encontrado.' });
        if (user.balance < plan.price) return res.status(400).json({ msg: 'Saldo insuficiente.' });

        // Processar compra
        user.balance -= plan.price;
        user.plan = plan._id;
        user.planStartDate = new Date();
        
        // Comissão para o afiliado
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
                }
            }
        }

        await user.save();
        res.json({ msg: `Plano ${plan.name} ativado com sucesso!` });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 8. Histórico
exports.getHistory = async (req, res) => {
    try {
        const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 9. CRIAÇÃO DE ADMIN MANUAL (TEMP)
exports.createAdminManually = async (req, res) => {
    try {
        const phone = '840000000'; // Defina seu número aqui
        const password = 'admin123'; // Defina sua senha aqui
        
        let user = await User.findOne({ phone });
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        if (user) {
            user.password = hashedPassword;
            user.role = 'admin';
            user.isActive = true;
            await user.save();
            return res.json({ msg: 'Usuário existente atualizado para ADMIN com sucesso!' });
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
        res.json({ msg: 'Usuário ADMIN criado com sucesso no Banco de Dados!' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};