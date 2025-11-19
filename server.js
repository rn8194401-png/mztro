const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const routes = require('./routes');

const app = express();

// Middlewares
app.use(express.json()); // Para ler JSON no corpo das requisições
app.use(cors({
    origin: '*', // Em produção, troque '*' pelo link do seu frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rotas da API
app.use('/api', routes);

// Rota de teste para verificar se o servidor está rodando
app.get('/', (req, res) => {
    res.send('API Volvic Investment está rodando!');
});

// Conexão com MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB conectado com sucesso!'))
    .catch((err) => console.error('❌ Erro ao conectar no MongoDB:', err));

// Iniciar o Servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});