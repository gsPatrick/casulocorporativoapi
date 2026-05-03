const Conexao = require('../../models/Conexao');
const Orcamento = require('../../models/Orcamento');
const shopifyAdmin = require('../../services/shopifyAdmin');
const { Op } = require('sequelize');

class ProfessionalService {
  /**
   * Cria um novo cliente na Shopify e o vincula ao profissional no DB
   */
  async createClient(proId, clientData) {
    // 1. Criar na Shopify via Admin API
    const shopifyResult = await shopifyAdmin.createCustomer({
      firstName: clientData.firstName,
      lastName: clientData.lastName,
      email: clientData.email,
      phone: clientData.phone,
      tags: ['acesso-restrito']
    });
    
    if (shopifyResult.userErrors && shopifyResult.userErrors.length > 0) {
      throw new Error(shopifyResult.userErrors[0].message);
    }
    
    const shopifyCustomer = shopifyResult.customer;
    const cleanId = shopifyCustomer.id.replace('gid://shopify/Customer/', '');

    // 2. Criar vínculo no nosso banco
    await Conexao.create({
      parent_id: proId.toString(),
      child_id: cleanId.toString(),
      child_name: `${shopifyCustomer.firstName || ''} ${shopifyCustomer.lastName || ''}`.trim(),
      child_email: shopifyCustomer.email,
      type: 'cliente',
      status: 'aceito'
    });

    return shopifyCustomer;
  }

  /**
   * Lista clientes vinculados a um profissional
   */
  async getLinkedClients(proId) {
    return await Conexao.findAll({
      where: { 
        parent_id: proId.toString(), 
        type: 'cliente' 
      },
      order: [['createdAt', 'DESC']]
    });
  }

  /**
   * Lista conexões aceitas entre profissionais (Consultor <-> Especificador)
   */
  async getAcceptedConnections(proId) {
    return await Conexao.findAll({
      where: {
        [Op.or]: [{ parent_id: proId.toString() }, { child_id: proId.toString() }],
        type: 'profissional',
        status: 'aceito'
      }
    });
  }

  /**
   * Lista convites pendentes recebidos
   */
  async getPendingInvites(proId, email) {
    return await Conexao.findAll({
      where: {
        [Op.or]: [
          { child_id: proId.toString() },
          { child_email: email }
        ],
        type: 'profissional',
        status: 'pendente'
      }
    });
  }

  /**
   * Envia convite para outro profissional
   */
  async createInvite(proId, inviteData) {
    const existing = await Conexao.findOne({
      where: {
        parent_id: proId.toString(),
        child_email: inviteData.email,
        type: 'profissional'
      }
    });

    if (existing) throw new Error('Já existe um convite ou conexão para este e-mail.');

    return await Conexao.create({
      parent_id: proId.toString(),
      parent_name: inviteData.from_name,
      parent_email: inviteData.from_email,
      child_id: 'pending', 
      child_email: inviteData.email,
      type: 'profissional',
      status: 'pendente'
    });
  }

  /**
   * Responde a um convite (Aceitar/Recusar)
   */
  async respondToInvite(proId, inviteId, status, name) {
    const invite = await Conexao.findByPk(inviteId);

    if (!invite) throw new Error('Convite não encontrado.');
    
    // Atualiza status e preenche dados do convidado ao aceitar
    await invite.update({ 
      status,
      child_id: status === 'aceito' ? proId.toString() : invite.child_id,
      child_name: status === 'aceito' ? name : invite.child_name
    });
    
    return invite;
  }
}

module.exports = new ProfessionalService();
