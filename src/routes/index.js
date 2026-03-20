const express = require('express');
const router = express.Router();
const orcamentoRoutes = require('../features/Orcamento/orcamento.routes');

router.use('/orcamento', orcamentoRoutes);
router.use('/api/orcamento', orcamentoRoutes); // Tolerância para duplicidade de rota
router.use('/', orcamentoRoutes); // Tolerância universal (Caso o Proxy remova o segmento /orcamento)

// Rota de saúde para o App Proxy (acessível via /api/health)
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

module.exports = router;
