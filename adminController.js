const { User, Plan, Transaction, SystemConfig } = require('./models');
const bcrypt = require('bcryptjs');

// --- 1. GERENCIAMENTO DE USUÁRIOS ---

// Listar todos os usuários (Resumo para a tabela)
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find()
            .select('-password') // Não mandar a senha
            .populate('plan', 'name') // Trazer o nome do plano
            .sort({ createdAt: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Ver detalhes COMPLETOS de um usuário
// (Usado na nova página admin-user-details.html)
exports.getUserDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Dados do Usuário (com plano e quem indicou ele)
        const user = await User.findById(id)
            .select('-password')
            .populate('plan')
            .populate('referrer', 'name phone'); // Traz nome e telefone do líder

        if (!user) return res.status(404).json({ msg: 'Usuário não encontrado' });

        // 2. Histórico Completo (Depósitos, Saques, Lucros, Comissões)
        const transactions = await Transaction.find({ user: id })
            .sort({ createdAt: -1 });

        // 3. Lista de Indicados (Quem esse usuário convidou)
        const referrals = await User.find({ referrer: id })
            .select('name phone createdAt balance');

        res.json({ user, transactions, referrals });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Atualizar usuário (Bloquear, Saldo, Senha, etc.)
exports.updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { balance, password, isActive, planId } = req.body;

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ msg: 'Usuário não encontrado' });

        // Atualizações manuais
        if (balance !== undefined) user.balance = Number(balance);
        if (isActive !== undefined) user.isActive = isActive;
        
        // Admin pode forçar a mudança de plano
        if (planId) {
            user.plan = planId;
            user.planStartDate = new Date();
        }

        // Admin pode resetar senha do usuário
        if (password && password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();
        res.json({ msg: 'Dados do usuário atualizados com sucesso.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- 2. GERENCIAMENTO DE PLANOS ---

// Criar Plano
exports.createPlan = async (req, res) => {
    try {
        const { name, price, dailyIncome, minDeposit, minWithdraw, maxWithdraw } = req.body;
        const imageUrl = req.file ? req.file.path : '';

        const newPlan = new Plan({
            name,
            price: Number(price),
            dailyIncome: Number(dailyIncome),
            imageUrl,
            minDeposit: Number(minDeposit || 0),
            minWithdraw: Number(minWithdraw),
            maxWithdraw: Number(maxWithdraw)
        });

        await newPlan.save();
        res.status(201).json({ msg: 'Plano criado com sucesso', plan: newPlan });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Editar Plano
exports.updatePlan = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        if (req.file) {
            updates.imageUrl = req.file.path;
        }

        await Plan.findByIdAndUpdate(id, updates);
        res.json({ msg: 'Plano atualizado com sucesso.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Listar Planos
exports.getAllPlans = async (req, res) => {
    try {
        const plans = await Plan.find();
        res.json(plans);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- 3. GERENCIAMENTO DE TRANSAÇÕES ---

// Transações Pendentes (Depósitos e Saques para aprovação)
exports.getPendingTransactions = async (req, res) => {
    try {
        const { type } = req.query;
        const filter = { status: 'pending' };
        if (type) filter.type = type;

        const transactions = await Transaction.find(filter)
            .populate('user', 'name phone balance')
            .sort({ createdAt: 1 });

        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Aprovar ou Rejeitar
exports.handleTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminComment } = req.body; 

        const transaction = await Transaction.findById(id).populate('user');
        if (!transaction) return res.status(404).json({ msg: 'Transação não encontrada' });
        
        if (transaction.status !== 'pending') {
            return res.status(400).json({ msg: 'Transação já processada.' });
        }

        transaction.status = status;
        transaction.adminComment = adminComment || '';

        // Depósito Aprovado = +Saldo
        if (transaction.type === 'deposit' && status === 'approved') {
            transaction.user.balance += transaction.amount;
            await transaction.user.save();
        } 
        // Saque Rejeitado = +Saldo (Devolução)
        else if (transaction.type === 'withdrawal' && status === 'rejected') {
            transaction.user.balance += transaction.amount;
            await transaction.user.save();
        }
        // Saque Aprovado = Nada muda no saldo (já foi descontado na solicitação)

        await transaction.save();
        res.json({ msg: 'Transação processada com sucesso.' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- 4. CONFIGURAÇÕES DO SISTEMA ---

exports.getSystemConfig = async (req, res) => {
    try {
        let config = await SystemConfig.findOne();
        if (!config) {
            config = new SystemConfig();
            await config.save();
        }
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateSystemConfig = async (req, res) => {
    try {
        const { depositAccounts, affiliateSettings, welcomeBonus } = req.body;
        
        let config = await SystemConfig.findOne();
        if (!config) config = new SystemConfig();

        if (depositAccounts) config.depositAccounts = depositAccounts;
        if (affiliateSettings) config.affiliateSettings = affiliateSettings;
        if (welcomeBonus !== undefined) config.welcomeBonus = Number(welcomeBonus);

        await config.save();
        res.json({ msg: 'Configurações atualizadas!', config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};