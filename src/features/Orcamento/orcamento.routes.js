const express = require('express');
const router = express.Router();
const orcamentoController = require('./orcamento.controller');
const { validateShopifyProxy, validateCustomerSession } = require('../../middleware/auth');

// Rota Temporária para o Bling baixar as imagens do snapshot (Sem HMAC do Shopify)
router.get('/temp-images/:token/:filename', orcamentoController.serveTempImage);

// Rota de TESTE para gerar PDF diretamente (Sem HMAC)
router.get('/test/generate-pdf/:id', orcamentoController.testGeneratePDF);

// Rotas de Autenticação OAuth2 do Bling (Sem HMAC do Shopify)
const blingAuthController = require('./bling.auth.controller');
router.get('/bling/auth', blingAuthController.authorize);
router.get('/bling/callback', blingAuthController.callback);

// Rotas públicas ou que não suportam HMAC via App Proxy (ex: <img> tags)
router.get('/images/:id/:index', orcamentoController.serveImage);
router.get('/sync-image/:customer_id/:variant_id', orcamentoController.serveSyncedImage);

// Rotas que podem ser chamadas tanto via Proxy quanto Diretamente (Configuração Híbrida)
// Para o modo Guest funcionar via URL Direta, estas rotas ficam acima do HMAC
router.post('/', orcamentoController.create);
router.post('/:id/snapshot', orcamentoController.uploadSnapshot);
router.get('/:id/pdf', orcamentoController.generatePDF);

// Rota de Redirecionamento de URL Curta (v4.0.0)
router.get('/go/:codigo', orcamentoController.redirectToConfig.bind(orcamentoController));

// Todas as rotas abaixo via App Proxy precisam de HMAC (Segurança Obrigatória)
router.use(validateShopifyProxy);

router.post('/sync-item', orcamentoController.syncItem);
router.post('/check-snapshots', orcamentoController.checkSnapshots);


// Rota sensível que exige confirmação da sessão do cliente (Validado por Shopify/Customer ID)
router.get('/cliente/:customer_id', validateCustomerSession, orcamentoController.listByCustomer);

module.exports = router;
