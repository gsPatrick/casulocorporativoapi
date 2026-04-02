const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');

// Home do App (Entry Point)
router.get('/', adminController.home.bind(adminController));

// Dashboard Admin (Protegido por Sessão do Shopify)
router.get('/dashboard', adminController.dashboard.bind(adminController));

// Ações do Admin
router.post('/orcamento/:id/status', adminController.updateStatus.bind(adminController));

module.exports = router;
