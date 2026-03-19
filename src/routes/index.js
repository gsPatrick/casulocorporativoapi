const express = require('express');
const router = express.Router();
const orcamentoRoutes = require('../features/Orcamento/orcamento.routes');

router.use('/orcamento', orcamentoRoutes);

// Rota de saúde para o App Proxy (acessível via /api/health)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

module.exports = router;
