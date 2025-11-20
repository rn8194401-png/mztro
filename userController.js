const { User, Plan, Transaction, SystemConfig } = require('./models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Função auxiliar para gerar código
const generateInviteCode = async () => {
    let code;
    let exists = true;
    while (exists) {
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
        const user = await User.findOne({ inviteCode: code });
        if (!user) exists = false;
    }
    return code;
};

// 1. Registro (AGORA RETORNA TOKEN PARA LOGIN AUTOMÁTICO)
exports.register = async (req, res) => {
    try {
        const { name, phone, password, referralCode } = req.body;

        if (!/^\d{9}$/.test(phone)) {
            return res.status(400).json({ msg: 'O número deve ter exatamente 9 dígitos.' });
        }

        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ msg: 'Número já cadastrado.' });

        let referrerId = null;
        if (referralCode) {
            const referrerUser = await User.findOne({ inviteCode: referralCode.toUpperCase() });
            if (referrerUser) referrerId = referrerUser._id;
        }

        const newInviteCode = await generateInviteCode();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const config = await SystemConfig.findOne();
        const bonus = config ? (config.welcomeBonus || 0) : 0;

        const newUser = new User({
            name,
            phone,
            password: hashedPassword,
            inviteCode: newInviteCode,
            referrer: referrerId,
            balance: bonus,
            hasInvested: false
        });

        await newUser.save();

        if (bonus > 0) {
            await Transaction.create({
                user: newUser._id,
                type: 'bonus',
                amount: bonus,
                status: 'approved',
                adminComment: 'Bônus de Boas-vindas'
            });
        }

        // --- MUDANÇA: GERAR TOKEN IMEDIATAMENTE ---
        const token = jwt.sign({ id: newUser._id, role: newUser.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(201).json({ 
            msg: 'Conta criada com sucesso!',
            token, // Envia o token
            user: {
                id: newUser._id,
                name: newUser.name,
                phone: newUser.phone,
                inviteCode: newUser.inviteCode,
                role: newUser.role
            }
        });

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
                inviteCode: user.inviteCode,
                role: user.role
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. Perfil
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password')
            .populate('plan')
            .populate('referrer', 'name phone inviteCode');
        
        const referrals = await User.find({ referrer: req.user.id });
        const totalInvitees = referrals.length;
        const activeInvitees = referrals.filter(u => u.plan !== null).length;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';

        res.json({ user, frontendUrl, stats: { totalInvitees, activeInvitees } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 4. Depósito
exports.deposit = async (req, res) => {
    try {
        const { amount, senderPhone } = req.body;
        if (!req.file) return res.status(400).json({ msg: 'Comprovante é obrigatório.' });
        if (!senderPhone) return res.status(400).json({ msg: 'Informe o número remetente.' });

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

// 5. Saque
exports.withdraw = async (req, res) => {
    try {
        const { amount, destinationName, destinationPhone } = req.body;
        const user = await User.findById(req.user.id).populate('plan');
        
        if (!user.plan) return res.status(400).json({ msg: 'Necessário plano VIP para sacar.' });

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

// 6. Coletar Lucro
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

        if (isSameDay) return res.status(400).json({ msg: 'Lucro já coletado hoje.' });

        const dailyProfit = user.plan.dailyIncome;
        user.balance += dailyProfit;
        user.lastDailyCollection = now;
        await user.save();

        await Transaction.create({
            user: user._id,
            type: 'daily',
            amount: dailyProfit,
            status: 'approved',
            adminComment: `Rendimento diário (${user.plan.name})`
        });
        
        // Comissão Recorrente
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            const percent = config?.affiliateSettings?.dailyIncomePercent || 0;
            if (percent > 0) {
                const commissionAmount = (dailyProfit * percent) / 100;
                if (commissionAmount > 0) {
                    const referrer = await User.findById(user.referrer);
                    if (referrer) {
                        referrer.balance += commissionAmount;
                        referrer.totalCommission += commissionAmount;
                        await referrer.save();

                        await Transaction.create({
                            user: referrer._id,
                            type: 'commission',
                            amount: commissionAmount,
                            status: 'approved',
                            fromUser: user.inviteCode,
                            adminComment: `Ganho recorrente (${percent}%)`
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

// 7. Comprar Plano (ATUALIZADO: LÓGICA DE DIFERENÇA DE VALOR)
exports.buyPlan = async (req, res) => {
    try {
        const { planId } = req.body;
        // Carrega usuário com o plano atual populado para ver o preço antigo
        const user = await User.findById(req.user.id).populate('plan'); 
        const targetPlan = await Plan.findById(planId);

        if (!targetPlan) return res.status(404).json({ msg: 'Plano não encontrado.' });

        // --- CÁLCULO DO VALOR A PAGAR ---
        let amountToPay = targetPlan.price;
        let isUpgrade = false;

        if (user.plan) {
            // Se já tem plano, paga a diferença
            if (targetPlan.price > user.plan.price) {
                amountToPay = targetPlan.price - user.plan.price;
                isUpgrade = true;
            } else if (targetPlan._id.equals(user.plan._id)) {
                return res.status(400).json({ msg: 'Você já possui este plano.' });
            } else {
                // Se tentar comprar um plano mais barato (downgrade)
                // Opção A: Bloquear. Opção B: Cobrar total. Vamos bloquear por enquanto.
                return res.status(400).json({ msg: 'Não é possível fazer downgrade de plano.' });
            }
        }

        // Verificar saldo
        if (user.balance < amountToPay) {
            return res.status(400).json({ msg: `Saldo insuficiente. Faltam ${(amountToPay - user.balance).toFixed(2)} MT.` });
        }

        // Descontar saldo e atualizar plano
        user.balance -= amountToPay;
        user.plan = targetPlan._id;
        user.planStartDate = new Date();
        
        // Se é upgrade, não conta como "primeiro investimento" novamente para bônus
        // mas se não tinha plano, conta.
        const isFirstTime = !user.hasInvested;
        user.hasInvested = true;
        
        await user.save();
        
        // Comissão (Baseada no valor que foi PAGO, ou seja, a diferença)
        // Se for upgrade, normalmente paga comissão sobre a diferença.
        // Se for primeira vez, paga sobre o total.
        if (user.referrer) {
            const config = await SystemConfig.findOne();
            const percent = config?.affiliateSettings?.firstInvestmentPercent || 0;
            
            // Regra: Paga comissão se for a primeira vez OU se for upgrade (sobre a diferença)
            // Se você quiser pagar comissão SÓ na primeira vez e NADA no upgrade, use: "if (user.referrer && isFirstTime)"
            // Se quiser pagar comissão proporcional no upgrade também, use o código abaixo:
            
            if (percent > 0 && amountToPay > 0) {
                // Verifica se é 1ª vez (lógica estrita do seu pedido anterior)
                // SE você quiser pagar no upgrade, remova o "&& isFirstTime"
                if (isFirstTime) { 
                    const commission = (amountToPay * percent) / 100;
                    
                    if (commission > 0) {
                        const referrer = await User.findById(user.referrer);
                        if (referrer) {
                            referrer.balance += commission;
                            referrer.totalCommission += commission;
                            await referrer.save();

                            await Transaction.create({
                                user: referrer._id,
                                type: 'commission',
                                amount: commission,
                                status: 'approved',
                                fromUser: user.inviteCode,
                                adminComment: `Comissão de Investimento (${percent}%)`
                            });
                        }
                    }
                }
            }
        }

        const msgType = isUpgrade ? 'Upgrade realizado' : 'Plano ativado';
        res.json({ msg: `${msgType} com sucesso! Valor pago: ${amountToPay} MT` });

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

// 9. Admin
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
            user.inviteCode = 'ADMIN';
            await user.save();
            return res.json({ msg: 'Atualizado para ADMIN!' });
        }

        const newAdmin = new User({
            name: 'Super Admin',
            phone: phone,
            password: hashedPassword,
            inviteCode: 'ADMIN',
            role: 'admin',
            isActive: true,
            balance: 0
        });

        await newAdmin.save();
        res.json({ msg: 'ADMIN criado!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};