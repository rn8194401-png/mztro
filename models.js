const mongoose = require('mongoose');

// 1. User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    // Código de convite
    inviteCode: { type: String, unique: true, required: true },
    
    balance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    
    // Dados do Plano
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    planStartDate: { type: Date },
    lastDailyCollection: { type: Date, default: null },
    
    // Controle de 1º investimento
    hasInvested: { type: Boolean, default: false },

    // Afiliados
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    totalCommission: { type: Number, default: 0 }, 
}, { timestamps: true });

// 2. Plan Schema (ATUALIZADO COM VALIDADE)
const planSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    dailyIncome: { type: Number, required: true },
    
    // NOVO CAMPO: Validade em dias (Ex: 30 dias, 60 dias)
    validity: { type: Number, required: true, default: 30 }, 

    imageUrl: { type: String },
    minDeposit: { type: Number, default: 0 },
    minWithdraw: { type: Number, required: true },
    maxWithdraw: { type: Number, required: true },
    isActive: { type: Boolean, default: true }
});

// 3. Transaction Schema
const transactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        enum: ['deposit', 'withdrawal', 'bonus', 'daily', 'commission'], 
        required: true 
    },
    amount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected'], 
        default: 'approved' 
    },
    proofImage: { type: String },
    senderPhone: { type: String },
    destinationPhone: { type: String },
    destinationName: { type: String },
    adminComment: { type: String },
    fromUser: { type: String } 
}, { timestamps: true });

// 4. System Config Schema
const configSchema = new mongoose.Schema({
    welcomeBonus: { type: Number, default: 0 },
    depositAccounts: [{
        network: String,
        number: String,
        ownerName: String
    }],
    affiliateSettings: {
        firstInvestmentPercent: { type: Number, default: 10 }, 
        dailyIncomePercent: { type: Number, default: 5 } 
    }
});

const User = mongoose.model('User', userSchema);
const Plan = mongoose.model('Plan', planSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const SystemConfig = mongoose.model('SystemConfig', configSchema);

module.exports = { User, Plan, Transaction, SystemConfig };