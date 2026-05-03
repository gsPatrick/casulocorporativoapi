const professionalService = require('./professional.service');

class ProfessionalController {
  /**
   * Endpoint para criar cliente via Shopify Admin API (Backend Only)
   */
  async createClient(req, res) {
    try {
      const proId = req.query.logged_in_customer_id;
      if (!proId) return res.status(401).json({ error: 'Usuário não autenticado' });
      
      const client = await professionalService.createClient(proId, req.body);
      res.status(201).json({
        success: true,
        customer: client
      });
    } catch (error) {
      console.error('[PRO CONTROLLER ERROR]:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Lista clientes vinculados ao profissional
   */
  async listClients(req, res) {
    try {
      const proId = req.query.logged_in_customer_id;
      if (!proId) return res.status(401).json({ error: 'Não autorizado' });

      const clients = await professionalService.getLinkedClients(proId);
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Lista conexões e convites
   */
  async listConnections(req, res) {
    try {
      const proId = req.query.logged_in_customer_id;
      const email = req.query.customer_email; // Passado pelo Liquid
      
      if (!proId) return res.status(401).json({ error: 'Não autorizado' });

      const connections = await professionalService.getAcceptedConnections(proId);
      const pending = await professionalService.getPendingInvites(proId, email);
      
      res.json({
        connections,
        invites: pending
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Envia convite para outro profissional
   */
  async invitePro(req, res) {
    try {
      const proId = req.query.logged_in_customer_id;
      if (!proId) return res.status(401).json({ error: 'Não autorizado' });

      const invite = await professionalService.createInvite(proId, req.body);
      res.status(201).json({ success: true, invite });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Responde a um convite
   */
  async respondInvite(req, res) {
    try {
      const proId = req.query.logged_in_customer_id;
      const { id } = req.params;
      const { status, name } = req.body;

      if (!proId) return res.status(401).json({ error: 'Não autorizado' });

      const result = await professionalService.respondToInvite(proId, id, status, name);
      res.json({ success: true, result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new ProfessionalController();
