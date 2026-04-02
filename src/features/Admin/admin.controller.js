const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');

class AdminController {
  /**
   * Página Inicial do App no Shopify (Entry Point)
   */
  async home(req, res) {
    try {
      const session = await this.validateSession(req, res);
      if (!session) return;

      res.render('features/Admin/views/home', {
        shop: session.shop,
        host: req.query.host,
        apiKey: process.env.SHOPIFY_API_KEY
      });
    } catch (error) {
      console.error('[ADMIN CONTROLLER]: Erro na Home:', error.message);
      res.status(500).send('Erro ao carregar página inicial');
    }
  }

  /**
   * Renderiza o Dashboard Admin protegido por sessão do Shopify
   */
  async dashboard(req, res) {
    try {
      // 1. Validar Sessão do Shopify (Obrigatório conforme briefing)
      // Nota: Em um app embedded, o token vem no Header 'Authorization: Bearer <token>'
      // ou via middleware do shopify.auth.
      const session = await this.validateSession(req, res);
      if (!session) return; // validateSession já enviou 401/403

      // 2. Buscar todos os orçamentos do banco Postgres
      const orcamentos = await Orcamento.findAll({
        order: [['createdAt', 'DESC']]
      });

      // 3. Renderizar EJS com Polaris
      res.render('features/Admin/views/dashboard', {
        orcamentos,
        shop: session.shop,
        host: req.query.host,
        apiKey: process.env.SHOPIFY_API_KEY
      });
    } catch (error) {
      console.error('[ADMIN CONTROLLER]: Erro no Dashboard:', error.message);
      res.status(500).send('Erro interno ao carregar painel');
    }
  }

  /**
   * Atualiza o status do orçamento e sincroniza com Shopify Metaobjects
   */
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body; // 'aprovado', 'cancelado', etc.
      
      const session = await this.validateSession(req, res);
      if (!session) return;

      const orcamento = await Orcamento.findByPk(id);
      if (!orcamento) return res.status(404).json({ error: 'Orçamento não encontrado' });

      // 1. Atualizar no Postgres
      await orcamento.update({ status });

      // 2. Sincronizar com Shopify Metaobject (Obrigatório conforme briefing)
      if (status === 'aprovado') {
        await this.syncStatusToShopify(orcamento, session);
      }

      res.json({ success: true, status: orcamento.status });
    } catch (error) {
      console.error('[ADMIN CONTROLLER]: Erro ao atualizar status:', error.message);
      res.status(500).json({ error: 'Erro ao processar atualização' });
    }
  }

  /**
   * Validação de Sessão conforme @shopify/shopify-api
   */
  async validateSession(req, res) {
    try {
      // Tenta carregar a sessão offline ou online
      const sessionId = await shopify.session.getCurrentId({
        isOnline: true,
        rawRequest: req,
        rawResponse: res,
      });

      if (!sessionId) {
        res.status(401).send('Não autorizado: Sessão Shopify inválida');
        return null;
      }

      const session = await shopify.config.sessionStorage.loadSession(sessionId);
      if (!session) {
        res.status(401).send('Sessão expirada');
        return null;
      }

      return session;
    } catch (err) {
      console.error('[ADMIN AUTH]: Falha na validação:', err.message);
      res.status(403).send('Erro de autenticação no Shopify');
      return null;
    }
  }

  /**
   * Atualiza o status do Metaobject no Shopify via GraphQL
   */
  async syncStatusToShopify(orcamento, session) {
    const client = new shopify.clients.Graphql({ session });
    
    // O PDF_URL ou outro campo armazena o GID do Metaobject
    // Caso contrário, precisaríamos buscar pelo ID do Orçamento
    const metaobjectId = orcamento.pdf_url; // No orcamento.service salvamos o GID aqui como 'pdf_url' temporariamente
    
    if (!metaobjectId || !metaobjectId.startsWith('gid://')) {
      console.warn('[ADMIN SYNC]: GID do Metaobject ausente para orçamento', orcamento.id);
      return;
    }

    const mutation = `
      mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject {
            fields {
              key
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: metaobjectId,
      metaobject: {
        fields: [
          { key: "status", value: "aprovado" }
        ]
      }
    };

    try {
      const response = await client.request(mutation, { variables });
      if (response.data.metaobjectUpdate.userErrors.length > 0) {
        console.error('[ADMIN SYNC ERROR]:', response.data.metaobjectUpdate.userErrors);
      } else {
        console.log('[ADMIN SYNC SUCCESS]: Status sincronizado no Shopify para', metaobjectId);
      }
    } catch (error) {
      console.error('[ADMIN SYNC FATAL]:', error.message);
    }
  }
}

module.exports = new AdminController();
