const express = require('express');
const router = express.Router();
const orcamentoController = require('./orcamento.controller');
const { validateShopifyProxy, validateCustomerSession } = require('../../middleware/auth');

// Todas as rotas via App Proxy precisam de HMAC
router.use(validateShopifyProxy);

router.post('/', orcamentoController.create);
router.get('/:id/pdf', orcamentoController.generatePDF);

// Rota sensível que exige confirmação da sessão do cliente
router.get('/cliente/:customer_id', validateCustomerSession, orcamentoController.listByCustomer);

module.exports = router;
