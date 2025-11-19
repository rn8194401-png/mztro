const { User, Plan, Transaction, SystemConfig } = require('./models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 1. Registro (COM BÔNUS)
exports.register = async (req, res) => {
    try {
        const { name, phone, password, referralId } = req.body;

        if (!/^\d{9}$/.test(phone)) return res.status(400).json({ msg: 'Número deve ter 9 dígitos.' });

        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ msg: 'Número já cadastrado.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Verificar Bônus de Boas-vindas
        const config = await SystemConfig.findOne();
        const bonus = config ? (config.welcomeBonus || 0) : 0;

        const newUser = new User({
            name,
            phone,
            password: hashedPassword,
            referrer: referralId || null,
            balance: bonus // Começa com o bônus
        });

        await newUser.save();

        // Registrar transação do bônus (opcional, para histórico)
        if (bonus > 0) {
            await Transaction.create({
                user: newUser._id,
                type: 'bonus',
                amount: bonus,
                status: 'approved',
                adminComment: 'Bônus de boas-vindas'
            });
        }
        
        res.status(201).json({ msg: 'Conta criada com sucesso!' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Login (Mantém igual)
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
            user: { id: user._id, name: user.name, phone: user.phone, role: user.role }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. Perfil (ENVIA URL DO FRONTEND DO .ENV)
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password')
            .populate('plan')
            .populate('referrer', 'name phone');
        
        // Envia também a URL base para o link de convite
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';

        res.json({ user, frontendUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 4. Depósito (COM NÚMERO DO REMETENTE)
exports.deposit = async (req, res) => {
    try {
        const { amount, senderPhone } = req.body; // Novo campo senderPhone
        
        if (!req.file) return res.status(400).json({ msg: 'Comprovante obrigatório.' });
        if (!senderPhone) return res.status(400).json({ msg: 'Informe o número que realizou a transferência.' });

        const newTransaction = new Transaction({
            user: req.user.id,
            type: 'deposit',
            amount: Number(amount),
            senderPhone: senderPhone,
            proofImage: req.file.path,
            status: 'pending'
        });

        await newTransaction.save();
        res.json({ msg: 'Depósito enviado para análise.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 5. Saque (COM NOME E NÚMERO MANUAL)
exports.withdraw = async (req, res) => {
    try {
        const { amount, destinationPhone, destinationName } = req.body;
        const user = await User.findById(req.user.id).populate('plan');
        
        if (!user.plan) return res.status(400).json({ msg: 'Necessário plano VIP para sacar.' });
        if (amount < user.plan.minWithdraw || amount > user.plan.maxWithdraw) {
            return res.status(400).json({ msg: `Limites: Min ${user.plan.minWithdraw} - Max ${user.plan.maxWithdraw}` });
        }
        if (user.balance < amount) return res.status(400).json({ msg: 'Saldo insuficiente.' });

        // Deduz saldo
        user.balance -= Number(amount);
        await user.save();

        const newTransaction = new Transaction({
            user: req.user.id,
            type: 'withdrawal',
            amount: Number(amount),
            destinationPhone: destinationPhone,
            destinationName: destinationName,
            status: 'pending'
        });

        await newTransaction.save();
        res.json({ msg: 'Saque solicitado com sucesso.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 6. Tarefa Diária (Mantém igual)
exports.collectDailyIncome = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('plan');
        if (!user.plan) return res.status(400).json({ msg: 'Nenhum plano ativo.' });

        const now = new Date();
        const lastCollection = user.lastDailyCollection ? new Date(user.lastDailyCollection) : null;
        const isSameDay = lastCollection && now.getDate() === lastCollection.getDate() && now.getMonth() === lastCollection.getMonth() && now.getFullYear() === lastCollection.getFullYear();

        if (isSameDay) return res.status(400).json({ msg: 'Já coletado hoje.' });

        user.balance += user.plan.dailyIncome;
        user.lastDailyCollection = now;
        
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            const reward = config?.affiliateSettings?.recurringReward || 0;
            if (reward > 0) {
                await User.findByIdAndUpdate(user.referrer, { $inc: { balance: reward, totalCommission: reward } });
            }
        }
        await user.save();
        res.json({ msg: `Lucro coletado!`, newBalance: user.balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 7. Comprar Plano (Mantém igual)
exports.buyPlan = async (req, res) => {
    try {
        const { planId } = req.body;
        const user = await User.findById(req.user.id);
        const plan = await Plan.findById(planId);

        if (!plan) return res.status(404).json({ msg: 'Plano não encontrado.' });
        if (user.balance < plan.price) return res.status(400).json({ msg: 'Saldo insuficiente.' });

        user.balance -= plan.price;
        user.plan = plan._id;
        user.planStartDate = new Date();
        
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            const percent = config?.affiliateSettings?.commissionPercent || 0;
            const commission = (plan.price * percent) / 100;
            if (commission > 0) {
                await User.findByIdAndUpdate(user.referrer, { $inc: { balance: commission, totalCommission: commission } });
            }
        }
        await user.save();
        res.json({ msg: `Plano ativado!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 8. Histórico (Mantém igual)
exports.getHistory = async (req, res) => {
    try {
        const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};