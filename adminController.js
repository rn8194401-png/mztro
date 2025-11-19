const { User, Plan, Transaction, SystemConfig } = require('./models');
const bcrypt = require('bcryptjs');

// --- 1. GERENCIAMENTO DE USUÁRIOS ---

// Listar todos os usuários
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Ver detalhes completos de um usuário (histórico e indicados)
exports.getUserDetails = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate('plan').populate('referrer', 'name phone');
        if (!user) return res.status(404).json({ msg: 'Usuário não encontrado' });

        const transactions = await Transaction.find({ user: user._id }).sort({ createdAt: -1 });
        const referrals = await User.find({ referrer: user._id }).select('name phone plan createdAt');

        res.json({ user, transactions, referrals });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Atualizar usuário (Bloquear, Mudar Senha, Saldo, Plano, Telefone)
exports.updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { balance, password, phone, isActive, planId } = req.body;

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ msg: 'Usuário não encontrado' });

        if (balance !== undefined) user.balance = balance;
        if (phone) user.phone = phone;
        if (isActive !== undefined) user.isActive = isActive;
        
        if (planId) {
            user.plan = planId;
            user.planStartDate = new Date(); // Reseta a data do plano
        }

        if (password) {
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
        const { name, price, dailyIncome, minWithdraw, maxWithdraw } = req.body;
        
        // Imagem vem do Cloudinary via middleware
        const imageUrl = req.file ? req.file.path : '';

        const newPlan = new Plan({
            name,
            price,
            dailyIncome,
            imageUrl,
            minWithdraw,
            maxWithdraw
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
        res.json({ msg: 'Plano atualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Listar Planos (Para o Admin ver e editar)
exports.getAllPlans = async (req, res) => {
    try {
        const plans = await Plan.find();
        res.json(plans);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- 3. GERENCIAMENTO DE TRANSAÇÕES (DEPÓSITOS E SAQUES) ---

// Pegar transações pendentes (filtro opcional por tipo)
exports.getPendingTransactions = async (req, res) => {
    try {
        const { type } = req.query; // ?type=deposit ou ?type=withdrawal
        const filter = { status: 'pending' };
        if (type) filter.type = type;

        const transactions = await Transaction.find(filter)
            .populate('user', 'name phone balance')
            .sort({ createdAt: 1 }); // Mais antigos primeiro

        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Aprovar ou Rejeitar Transação
exports.handleTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminComment } = req.body; // status: 'approved' ou 'rejected'

        const transaction = await Transaction.findById(id).populate('user');
        if (!transaction) return res.status(404).json({ msg: 'Transação não encontrada' });
        if (transaction.status !== 'pending') return res.status(400).json({ msg: 'Transação já processada' });

        transaction.status = status;
        transaction.adminComment = adminComment || '';

        if (transaction.type === 'deposit') {
            if (status === 'approved') {
                // Adiciona saldo ao usuário
                transaction.user.balance += transaction.amount;
                await transaction.user.save();
            }
        } else if (transaction.type === 'withdrawal') {
            if (status === 'rejected') {
                // Devolve o dinheiro ao usuário (foi deduzido na solicitação)
                transaction.user.balance += transaction.amount;
                await transaction.user.save();
            }
            // Se approved, o saldo já foi retirado no userController, não faz nada além de mudar status
        }

        await transaction.save();
        res.json({ msg: `Transação ${status === 'approved' ? 'aprovada' : 'rejeitada'} com sucesso.` });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- 4. CONFIGURAÇÕES DO SISTEMA (CONTAS E AFILIADOS) ---

// Obter configurações atuais
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

// Atualizar configurações
exports.updateSystemConfig = async (req, res) => {
    try {
        const { depositAccounts, affiliateSettings } = req.body;
        
        let config = await SystemConfig.findOne();
        if (!config) config = new SystemConfig();

        if (depositAccounts) config.depositAccounts = depositAccounts;
        if (affiliateSettings) config.affiliateSettings = affiliateSettings;

        await config.save();
        res.json({ msg: 'Configurações atualizadas', config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};