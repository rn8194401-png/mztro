const jwt = require('jsonwebtoken');
require('dotenv').config();

// Middleware para verificar se o usuário está autenticado
const auth = (req, res, next) => {
    const tokenHeader = req.header('Authorization');

    // Verifica se o token existe
    if (!tokenHeader) {
        return res.status(401).json({ msg: 'Acesso negado. Nenhum token fornecido.' });
    }

    try {
        // O formato geralmente é "Bearer SEU_TOKEN", pegamos a segunda parte
        const token = tokenHeader.split(" ")[1]; 
        
        if (!token) {
             return res.status(401).json({ msg: 'Token mal formatado.' });
        }

        // Verifica a validade do token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Adiciona os dados do usuário (id, role) na requisição
        next();
    } catch (err) {
        res.status(400).json({ msg: 'Token inválido.' });
    }
};

// Middleware para verificar se o usuário é Admin
const admin = (req, res, next) => {
    // auth deve ser executado antes de admin
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ msg: 'Acesso negado. Área restrita para administradores.' });
    }
};

module.exports = { auth, admin };