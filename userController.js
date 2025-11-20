const { User, Plan, Transaction, SystemConfig } = require('./models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Função auxiliar para gerar código de convite único de 5 dígitos
const generateInviteCode = async () => {
    let code;
    let exists = true;
    while (exists) {
        // Gera string aleatória, pega 5 caracteres e converte para maiúsculo (Ex: A1B2C)
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
        const user = await User.findOne({ inviteCode: code });
        if (!user) exists = false;
    }
    return code;
};

// 1. Registro de Usuário
exports.register = async (req, res) => {
    try {
        const { name, phone, password, referralCode } = req.body;

        // Validar formato do telefone
        if (!/^\d{9}$/.test(phone)) {
            return res.status(400).json({ msg: 'O número deve ter exatamente 9 dígitos.' });
        }

        // Verificar se o telefone já existe
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ msg: 'Número já cadastrado.' });

        // Buscar Líder (Referrer) pelo código de 5 dígitos
        let referrerId = null;
        if (referralCode) {
            const referrerUser = await User.findOne({ inviteCode: referralCode.toUpperCase() });
            if (referrerUser) {
                referrerId = referrerUser._id;
            }
        }

        // Gerar novo código para o usuário
        const newInviteCode = await generateInviteCode();

        // Hash da senha
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Verificar Bônus de Boas-Vindas
        const config = await SystemConfig.findOne();
        const bonus = config ? (config.welcomeBonus || 0) : 0;

        // Criar usuário
        const newUser = new User({
            name,
            phone,
            password: hashedPassword,
            inviteCode: newInviteCode,
            referrer: referrerId,
            balance: bonus,
            hasInvested: false // Começa como false
        });

        await newUser.save();

        // Registrar transação de bônus (se houver)
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
                inviteCode: user.inviteCode, // Envia o código para o frontend usar
                role: user.role
            }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. Obter Perfil e Dashboard (Com Estatísticas de Convite)
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password')
            .populate('plan')
            .populate('referrer', 'name phone inviteCode');
        
        // Buscar todos os indicados
        const referrals = await User.find({ referrer: req.user.id });
        
        // Total de pessoas convidadas
        const totalInvitees = referrals.length;
        
        // Total de pessoas que investiram (têm plano ativo)
        const activeInvitees = referrals.filter(u => u.plan !== null).length;

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';

        res.json({ 
            user, 
            frontendUrl,
            stats: {
                totalInvitees,
                activeInvitees
            }
        });
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

// 6. Coletar Lucros (Com Comissão Recorrente sobre Lucro Diário)
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

        // 1. Adiciona lucro ao usuário
        const dailyProfit = user.plan.dailyIncome;
        user.balance += dailyProfit;
        user.lastDailyCollection = now;
        await user.save();

        // Histórico do Usuário
        await Transaction.create({
            user: user._id,
            type: 'daily',
            amount: dailyProfit,
            status: 'approved',
            adminComment: `Rendimento diário (${user.plan.name})`
        });
        
        // 2. Comissão para o Líder (Sobre o Lucro Diário)
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            // Pega a % configurada no admin (dailyIncomePercent)
            const percent = config?.affiliateSettings?.dailyIncomePercent || 0;
            
            if (percent > 0) {
                const commissionAmount = (dailyProfit * percent) / 100;

                if (commissionAmount > 0) {
                    const referrer = await User.findById(user.referrer);
                    if (referrer) {
                        referrer.balance += commissionAmount;
                        referrer.totalCommission += commissionAmount;
                        await referrer.save();

                        // Histórico do Líder
                        await Transaction.create({
                            user: referrer._id,
                            type: 'commission',
                            amount: commissionAmount,
                            status: 'approved',
                            fromUser: user.inviteCode, // Mostra código de quem gerou
                            adminComment: `Ganho recorrente (${percent}%) do lucro diário`
                        });
                    }
                }
            }
        }

        res.json({ msg: `Lucro de ${dailyProfit} MT coletado!`, newBalance: user.balance });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 7. Comprar Plano (Com Bônus APENAS no 1º Investimento)
exports.buyPlan = async (req, res) => {
    try {
        const { planId } = req.body;
        const user = await User.findById(req.user.id);
        const plan = await Plan.findById(planId);

        if (!plan) return res.status(404).json({ msg: 'Plano não encontrado.' });
        if (user.balance < plan.price) return res.status(400).json({ msg: 'Saldo insuficiente.' });

        // Processar Compra
        user.balance -= plan.price;
        user.plan = plan._id;
        user.planStartDate = new Date();
        
        // Verificar se é o primeiro investimento
        const isFirstTime = !user.hasInvested;
        
        // Marca que já investiu
        user.hasInvested = true;
        await user.save();
        
        // Lógica de Comissão (Apenas se for a primeira vez)
        if (user.referrer && isFirstTime) {
            const config = await SystemConfig.findOne();
            // Pega a % configurada no admin (firstInvestmentPercent)
            const percent = config?.affiliateSettings?.firstInvestmentPercent || 0;
            
            if (percent > 0) {
                const commission = (plan.price * percent) / 100;
                
                if (commission > 0) {
                    const referrer = await User.findById(user.referrer);
                    if (referrer) {
                        referrer.balance += commission;
                        referrer.totalCommission += commission;
                        await referrer.save();

                        // Histórico do Líder
                        await Transaction.create({
                            user: referrer._id,
                            type: 'commission',
                            amount: commission,
                            status: 'approved',
                            fromUser: user.inviteCode,
                            adminComment: `Bônus de 1º Investimento (${percent}%)`
                        });
                    }
                }
            }
        }

        res.json({ msg: `Plano ${plan.name} ativado com sucesso!` });

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

// 9. Criar Admin Manualmente (Garante código ADMIN)
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
            user.inviteCode = 'ADMIN'; // Código fixo
            await user.save();
            return res.json({ msg: 'Usuário atualizado para ADMIN!' });
        }

        const newAdmin = new User({
            name: 'Super Admin',
            phone: phone,
            password: hashedPassword,
            inviteCode: 'ADMIN', // Código fixo
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