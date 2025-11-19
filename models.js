const mongoose = require('mongoose');

// 1. User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    
    // Campos de Plano e Ganhos
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    planStartDate: { type: Date },
    lastDailyCollection: { type: Date, default: null },
    
    // Campos de Indicação (Afiliados)
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    totalCommission: { type: Number, default: 0 }, // Acumulado de ganhos por indicação
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

// 3. Transaction Schema (ATUALIZADO PARA HISTÓRICO COMPLETO)
const transactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // Adicionado 'daily' (lucro diário) e 'commission' (ganho por indicação)
    type: { 
        type: String, 
        enum: ['deposit', 'withdrawal', 'bonus', 'daily', 'commission'], 
        required: true 
    },
    
    amount: { type: Number, required: true },
    
    // Status padrão 'approved' para lucros automáticos, 'pending' para depósitos/saques
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected'], 
        default: 'approved' 
    },
    
    // Campos específicos de Depósito
    proofImage: { type: String }, // URL da imagem
    senderPhone: { type: String }, // Quem enviou o dinheiro
    
    // Campos específicos de Saque (Levantamento)
    destinationPhone: { type: String }, 
    destinationName: { type: String }, 
    
    // Detalhes administrativos ou do sistema
    adminComment: { type: String },
    
    // NOVO: Armazena o telefone/nome de quem gerou a comissão (Ex: "841234567")
    fromUser: { type: String } 

}, { timestamps: true });

// 4. System Config Schema
const configSchema = new mongoose.Schema({
    welcomeBonus: { type: Number, default: 0 }, // Bônus ao registrar
    depositAccounts: [{
        network: String, // Ex: M-Pesa, e-Mola
        number: String,
        ownerName: String
    }],
    affiliateSettings: {
        commissionPercent: { type: Number, default: 10 }, // % na compra do plano
        recurringReward: { type: Number, default: 0 } // Valor fixo quando indicado coleta lucro (opcional)
    }
});

const User = mongoose.model('User', userSchema);
const Plan = mongoose.model('Plan', planSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const SystemConfig = mongoose.model('SystemConfig', configSchema);

module.exports = { User, Plan, Transaction, SystemConfig };