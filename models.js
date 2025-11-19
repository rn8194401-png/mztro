const mongoose = require('mongoose');

// 1. User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    planStartDate: { type: Date },
    lastDailyCollection: { type: Date, default: null },
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    totalCommission: { type: Number, default: 0 },
}, { timestamps: true });

// 2. Plan Schema
const planSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    dailyIncome: { type: Number, required: true },
    imageUrl: { type: String },
    minDeposit: { type: Number, default: 0 },
    minWithdraw: { type: Number, required: true },
    maxWithdraw: { type: Number, required: true },
    isActive: { type: Boolean, default: true }
});

// 3. Transaction Schema (ATUALIZADO)
const transactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'withdrawal', 'bonus'], required: true }, // Adicionado 'bonus'
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    
    // Campos Novos
    proofImage: { type: String }, // Apenas depósito
    senderPhone: { type: String }, // Apenas depósito (quem enviou)
    
    destinationPhone: { type: String }, // Apenas saque
    destinationName: { type: String }, // Apenas saque
    
    adminComment: { type: String },
}, { timestamps: true });

// 4. System Config Schema (ATUALIZADO)
const configSchema = new mongoose.Schema({
    welcomeBonus: { type: Number, default: 100 }, // Novo Bônus
    depositAccounts: [{
        network: String,
        number: String,
        ownerName: String
    }],
    affiliateSettings: {
        commissionPercent: { type: Number, default: 10 },
        recurringReward: { type: Number, default: 0 }
    }
});

const User = mongoose.model('User', userSchema);
const Plan = mongoose.model('Plan', planSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const SystemConfig = mongoose.model('SystemConfig', configSchema);

module.exports = { User, Plan, Transaction, SystemConfig };