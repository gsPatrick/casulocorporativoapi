const express = require('express');
const router = express.Router();
const orcamentoRoutes = require('../features/Orcamento/orcamento.routes');

router.use('/orcamento', orcamentoRoutes);

module.exports = router;
