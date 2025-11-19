const express = require('express');
const router = express.Router();

// Importar Controladores
const userController = require('./userController');
const adminController = require('./adminController');

// Importar Middlewares e Configurações
const { auth, admin } = require('./middleware');
const { upload } = require('./cloudConfig');

/* ==========================================
   ROTAS PÚBLICAS (Registro e Login)
========================================== */
router.post('/register', userController.register);
router.post('/login', userController.login);

/* ==========================================
   ROTAS DO USUÁRIO (Requer Login)
========================================== */
// Obter dados do dashboard
router.get('/user/profile', auth, userController.getUserProfile);

// Financeiro
router.post('/user/deposit', auth, upload.single('image'), userController.deposit); // 'image' é o nome do campo no form
router.post('/user/withdraw', auth, userController.withdraw);

// Ações na plataforma
router.post('/user/daily', auth, userController.collectDailyIncome); // Coletar lucro
router.post('/user/buy-plan', auth, userController.buyPlan);

/* ==========================================
   ROTAS COMPARTILHADAS (Usuário e Admin)
========================================== */
// Listar planos disponíveis (Usuário precisa ver para comprar)
router.get('/plans', auth, adminController.getAllPlans);

// Ver contas de depósito (Usuário precisa ver para onde mandar dinheiro)
router.get('/config', auth, adminController.getSystemConfig);

/* ==========================================
   ROTAS DO ADMIN (Requer Login + Role Admin)
========================================== */

// Gerenciar Usuários
router.get('/admin/users', auth, admin, adminController.getAllUsers);
router.get('/admin/users/:id', auth, admin, adminController.getUserDetails);
router.put('/admin/users/:id', auth, admin, adminController.updateUser);

// Gerenciar Planos
router.post('/admin/plans', auth, admin, upload.single('image'), adminController.createPlan);
router.put('/admin/plans/:id', auth, admin, upload.single('image'), adminController.updatePlan);

// Gerenciar Transações (Depósitos e Saques)
router.get('/admin/transactions', auth, admin, adminController.getPendingTransactions);
router.put('/admin/transactions/:id', auth, admin, adminController.handleTransaction); // Aprovar/Rejeitar

// Configurações do Sistema (Contas Bancárias e Afiliados)
router.put('/admin/config', auth, admin, adminController.updateSystemConfig);

module.exports = router;