const express = require('express');
const router = express.Router();
const professionalController = require('./professional.controller');

// Rotas para gestão de clientes pelo profissional
router.post('/customer/create', professionalController.createClient);
router.get('/customers', professionalController.listClients);

// Rotas para gestão de conexões entre profissionais (Consultor/Especificador)
router.get('/connections', professionalController.listConnections);
router.post('/invite', professionalController.invitePro);
router.post('/invite/:id/respond', professionalController.respondInvite);

module.exports = router;
