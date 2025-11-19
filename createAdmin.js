// Arquivo: createAdmin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models'); // Importa o modelo
require('dotenv').config();

// --- CONFIGURE AQUI SEU ADMIN ---
const adminPhone = '840000000'; // Use 9 dígitos
const adminPassword = 'admin123';
const adminName = 'Super Admin';
// --------------------------------

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🔌 Conectado ao MongoDB...');

        // Verifica se já existe
        const userExists = await User.findOne({ phone: adminPhone });
        if (userExists) {
            console.log('⚠️  Este número já está cadastrado.');
            if(userExists.role === 'admin') {
                console.log('✅  E ele já é um Admin!');
            } else {
                console.log('🔄  Atualizando usuário para Admin...');
                userExists.role = 'admin';
                await userExists.save();
                console.log('✅  Agora ele é um Admin.');
            }
            process.exit();
        }

        // Hash da senha
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        // Criar Admin
        const newAdmin = new User({
            name: adminName,
            phone: adminPhone,
            password: hashedPassword,
            role: 'admin',
            isActive: true,
            balance: 0
        });

        await newAdmin.save();
        console.log('🎉  ADMIN CRIADO COM SUCESSO!');
        console.log(`👤  Login: ${adminPhone}`);
        console.log(`🔑  Senha: ${adminPassword}`);

        process.exit();
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
};

createAdmin();