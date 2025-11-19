const mongoose = require('mongoose');

// 1. Schema de Usuário
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { 
        type: String, 
        required: true, 
        unique: true, 
        minlength: 9, 
        maxlength: 9 
    },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    
    // Plano Atual
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    planStartDate: { type: Date },
    lastDailyCollection: { type: Date, default: null }, // Controle da tarefa diária
    
    // Sistema de Afiliados
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    totalCommission: { type: Number, default: 0 },
    
}, { timestamps: true });

// 2. Schema de Planos de Investimento
const planSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true }, // Valor do plano
    dailyIncome: { type: Number, required: true }, // Renda diária
    imageUrl: { type: String }, // URL do Cloudinary
    minDeposit: { type: Number, default: 0 },
    minWithdraw: { type: Number, required: true },
    maxWithdraw: { type: Number, required: true },
    isActive: { type: Boolean, default: true }
});

// 3. Schema de Transações (Depósitos e Saques)
const transactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'withdrawal'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    proofImage: { type: String }, // URL do comprovante (apenas para depósitos)
    adminComment: { type: String }, // Motivo de rejeição, se houver
}, { timestamps: true });

// 4. Schema de Configurações do Sistema (Admin)
// Armazena contas bancárias para depósito e % de afiliados
const configSchema = new mongoose.Schema({
    depositAccounts: [{
        network: String, // Ex: M-Pesa, e-Mola
        number: String,
        ownerName: String
    }],
    affiliateSettings: {
        commissionPercent: { type: Number, default: 10 }, // % sobre investimento
        recurringReward: { type: Number, default: 0 } // Valor fixo diário por indicado ativo
    }
});

// Exportar Modelos
const User = mongoose.model('User', userSchema);
const Plan = mongoose.model('Plan', planSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const SystemConfig = mongoose.model('SystemConfig', configSchema);

module.exports = { User, Plan, Transaction, SystemConfig };