const express = require('express');
const router = express.Router();
const adminController = require('./admin.controller');

// Home do App (Entry Point)
router.get('/', adminController.home.bind(adminController));

// Dashboard Admin (Protegido por Sessão do Shopify)
router.get('/dashboard', adminController.dashboard.bind(adminController));

// Ações do Admin
router.post('/orcamento/:id/status', adminController.updateStatus.bind(adminController));
router.post('/orcamento/:id/update', adminController.updateOrcamento.bind(adminController));

// Gestão de Condições Comerciais (v5.0.0)
router.get('/condicoes', adminController.listCondicoes.bind(adminController));
router.post('/condicoes', adminController.createCondicao.bind(adminController));
router.post('/condicoes/:id/update', adminController.updateCondicao.bind(adminController));
router.post('/condicoes/:id/set-default', adminController.setDefaultCondicao.bind(adminController));

// Gestão de IDs Sequenciais (v12.33.20)
router.post('/flow/next-code', adminController.getNextCustomerCode.bind(adminController));
router.post('/flow/update-customer', adminController.updateCustomerFromFlow.bind(adminController));
router.get('/settings/data', adminController.getSettingsData.bind(adminController));
router.post('/settings/update', adminController.updateSettings.bind(adminController));

module.exports = router;
