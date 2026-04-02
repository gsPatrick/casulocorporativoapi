const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');
const OrcamentoService = require('../Orcamento/orcamento.service');
const orcService = OrcamentoService;

class AdminController {
  /**
   * Página Inicial do App no Shopify (Entry Point)
   */
  async home(req, res) {
    try {
      // Para a Home (Entry Point), validamos o HMAC do Shopify em vez da Sessão Completa,
      // pois o App Bridge ainda será inicializado para autenticar.
      const isValidRequest = await this.validateHmac(req, res);
      if (!isValidRequest) return;

      res.render('features/Admin/views/home', {
        shop: req.query.shop,
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
      // Para renderizar o HTML do Dashboard, também usamos HMAC Fallback.
      // O App Bridge no frontend cuidará de manter a sessão ativa para os POSTs.
      const isValidRequest = await this.validateHmac(req, res);
      if (!isValidRequest) return;

      // 2. Buscar todos os orçamentos do banco Postgres
      const orcamentos = await Orcamento.findAll({
        order: [['createdAt', 'DESC']]
      });

      // 3. Renderizar EJS com Polaris
      res.render('features/Admin/views/dashboard', {
        orcamentos,
        shop: req.query.shop,
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
   * Validação de HMAC para requisições iniciais (GET HTML)
   */
  async validateHmac(req, res) {
    try {
      // shopify-api v11+ valida hmac de query params
      const isValid = await shopify.utils.validateHmac(req.query);
      if (!isValid) {
        res.status(401).send('Não autorizado: Assinatura HMAC inválida');
        return false;
      }
      return true;
    } catch (err) {
      console.error('[ADMIN HMAC]: Falha na validação:', err.message);
      res.status(403).send('Erro de segurança no link do Shopify');
      return false;
    }
  }

  /**
   * Atualiza os itens e o valor total do orçamento (v4.2.0)
   */
  async updateOrcamento(req, res) {
    try {
      const { id } = req.params;
      const { items, discount_type, discount_value } = req.body;
      
      const session = await this.validateSession(req, res);
      if (!session) return;

      const orcamento = await Orcamento.findByPk(id);
      if (!orcamento) return res.status(404).json({ error: 'Orçamento não encontrado' });

      // 1. Recalcular Subtotal dos Itens
      let subtotal = 0;
      const updatedItems = orcamento.line_items_json.map((dbItem, index) => {
        const edited = items[index];
        const itemData = typeof dbItem.get === 'function' ? dbItem.get({ plain: true }) : dbItem;

        if (edited) {
          // Limpar máscara de moeda (R$ 1.234,56 -> 1234.56)
          const cleanPrice = edited.price.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
          const price = parseFloat(cleanPrice) || 0;
          const qty = parseInt(itemData.quantity) || 1;
          subtotal += price * qty;
          return {
            ...itemData,
            title: edited.title || itemData.title,
            price: price.toFixed(2),
            technical_specification: edited.technical_specification || itemData.technical_specification
          };
        }
        const price = parseFloat(itemData.price) || 0;
        subtotal += price * (itemData.quantity || 1);
        return itemData;
      });

      // 2. Processar Desconto Centralizado
      let discountAmount = 0;
      let discountCategory = orcamento.discount_category;

      if (discount_type === 'none') {
        discountAmount = 0;
        discountCategory = null;
      } else if (discount_type === 'novo') {
        discountAmount = subtotal * 0.10;
        discountCategory = 'Cliente Novo';
      } else if (discount_type === 'ocasional') {
        discountAmount = subtotal * 0.15;
        discountCategory = 'Cliente Ocasional';
      } else if (discount_type === 'recorrente') {
        discountAmount = subtotal * 0.20;
        discountCategory = 'Cliente Recorrente';
      } else if (discount_type === 'manual_percent') {
        const pct = parseFloat(discount_value.replace(',', '.')) || 0;
        discountAmount = subtotal * (pct / 100);
        discountCategory = 'Desconto Manual (%)';
      } else if (discount_type === 'manual_fixed') {
        const cleanVal = discount_value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
        discountAmount = parseFloat(cleanVal) || 0;
        discountCategory = 'Desconto Manual (R$)';
      }

      const newTotal = subtotal - discountAmount;

      // 3. Persistir no Banco de Dados
      await orcamento.update({
        line_items_json: updatedItems,
        original_price: subtotal,
        discount_amount: discountAmount,
        discount_category: discountCategory,
        total_price: newTotal
      });

      // 3. Reenviar e-mail se for convidado (Lead) para notificar do novo PDF (v4.2.1)
      if (orcamento.customer_type === 'convidado') {
        console.log(`[ADMIN]: Reenviando orçamento atualizado para: ${orcamento.customer_email}`);
        await orcService.sendCommercialNotification(orcamento);
      }

      res.json({ success: true, total: newTotal });
    } catch (error) {
      console.error('[ADMIN CONTROLLER]: Erro ao atualizar orçamento:', error.message);
      res.status(500).json({ error: 'Erro ao salvar alterações' });
    }
  }

  /**
   * Validação de Sessão conforme @shopify/shopify-api
   */
  async validateSession(req, res) {
    try {
      // 1. Extrair o Token (Bearer ou URL)
      const authHeader = req.headers.authorization;
      const sessionToken = authHeader ? authHeader.replace('Bearer ', '') : req.query.id_token;

      if (!sessionToken) {
        console.warn('[ADMIN AUTH]: Nenhum Token de Sessão encontrado');
        res.status(401).send('Não autorizado: Token ausente');
        return null;
      }

      // 2. Decodificar o Token para obter Shop e User (v11+ padrão)
      // Se loadSession falhar na memória, o decodeSessionToken ainda nos dá a identidade.
      let payload;
      try {
        payload = await shopify.session.decodeSessionToken(sessionToken);
      } catch (err) {
        console.error('[ADMIN AUTH]: Erro ao decodificar JWT:', err.message);
        res.status(401).send('Token inválido ou expirado');
        return null;
      }

      const shop = payload.dest.replace('https://', '');
      console.log(`[ADMIN AUTH]: Requisição autenticada para o shop: ${shop}`);

      // 3. Tentar carregar sessão real do Storage (se existir)
      const sessionId = await shopify.session.getCurrentId({
        isOnline: true,
        rawRequest: req,
        rawResponse: res,
      });

      let session = null;
      if (sessionId && shopify.config.sessionStorage) {
         session = await shopify.config.sessionStorage.loadSession(sessionId);
      }

      // Se não houver sessão ativa no storage, criamos um objeto "mock" com o shop 
      // para permitir as operações no banco de dados local.
      if (!session) {
        console.info('[ADMIN AUTH]: Usando sessão baseada em JWT para operação local.');
        return { shop, isActive: () => true };
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
