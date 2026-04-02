const express = require('express');
const router = express.Router();
router.use((req, res, next) => {
  console.log(`[ROUTER LOG]: Request Received at routes/index.js - Path: ${req.path}, URL: ${req.url}`);
  next();
});

const orcamentoRoutes = require('../features/Orcamento/orcamento.routes');
const adminRoutes = require('../features/Admin/admin.routes');

// Rotas unificadas para suportar tanto chamadas diretas quanto via App Proxy
router.use('/orcamento', orcamentoRoutes);
router.use('/api/orcamento', orcamentoRoutes); 
router.use('/admin', adminRoutes); // Dashboard e Adm (v4.0.0)
router.use('/', adminRoutes);      // Entry Point do App (v4.1.0)

// Rota raiz para redirecionamentos e redundância
router.use('/', (req, res, next) => {
  if (req.url.includes('/orcamento')) return next(); // Deixa passar se for orcamento
  next();
}); // Caso o Proxy remova o segmento /orcamento

// Rota de saúde para o App Proxy (acessível via /api/health)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

module.exports = router;
