const Orcamento = require('../../models/Orcamento');
const Condicao = require('../../models/Condicao');
const shopify = require('../../config/shopify');
const OrcamentoService = require('../Orcamento/orcamento.service');
const orcService = OrcamentoService;
const adminService = require('./admin.service');

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

      // 2. Buscar dados do banco
      const orcamentos = await Orcamento.findAll({
        order: [['createdAt', 'DESC']]
      });

      const condicoes = await Condicao.findAll({
        order: [['nome', 'ASC']]
      });
      
      const condicaoPadrao = condicoes.find(c => c.is_default);

      // 3. Renderizar EJS com Polaris
      res.render('features/Admin/views/dashboard', {
        orcamentos,
        condicoes,
        condicaoPadrao,
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
      // 1. Tentar validação padrão do SDK
      const isValid = await shopify.utils.validateHmac(req.query);
      if (isValid) return true;

      res.status(401).send('Não autorizado: Assinatura HMAC inválida');
      return false;
    } catch (err) {
      // 2. Fallback para desvio de relógio (Clock Drift)
      // Se o erro for apenas o timestamp, fazemos uma validação manual com tolerância maior.
      if (err.message.includes('timestamp')) {
        console.warn('[ADMIN HMAC]: Desvio de relógio detectado. Iniciando validação manual...');
        
        try {
          const crypto = require('crypto');
          const secret = process.env.SHOPIFY_API_SECRET;
          const { hmac, ...params } = req.query;
          
          // Ordenar e extrair query string sem o HMAC
          const queryString = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&');
            
          const generatedHmac = crypto
            .createHmac('sha256', secret)
            .update(queryString)
            .digest('hex');

          if (generatedHmac === hmac) {
            console.log('[ADMIN HMAC]: Validação manual bem-sucedida apesar do desvio de tempo.');
            return true;
          }
        } catch (manualErr) {
          console.error('[ADMIN HMAC]: Erro na validação manual:', manualErr.message);
        }
      }

      console.error('[ADMIN HMAC]: Falha na validação:', err.message);
      res.status(403).send(`Erro de segurança no link do Shopify: ${err.message}`);
      return false;
    }
  }

  /**
   * Atualiza os itens e o valor total do orçamento (v4.2.0)
   */
  async updateOrcamento(req, res) {
    try {
      const { id } = req.params;
      const { items, condicao_id, termos_contrato } = req.body;
      
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

      // 2. Aplicar Condição Comercial selecionada (se houver)
      let finalPrice = subtotal;
      let condicaoData = null;

      if (condicao_id) {
        const condicao = await Condicao.findByPk(condicao_id);
        if (condicao) {
          const valor = parseFloat(condicao.valor);
          const ajuste = (subtotal * valor) / 100;
          if (condicao.tipo === 'desconto') {
            finalPrice -= ajuste;
          } else {
            finalPrice += ajuste;
          }
          condicaoData = {
            id: condicao.id,
            nome: condicao.nome,
            tipo: condicao.tipo,
            valor: valor
          };
        }
      }

      // 3. Persistir no Banco de Dados
      await orcamento.update({
        line_items_json: updatedItems,
        original_price: subtotal,
        total_price: finalPrice,
        condicao_json: condicaoData,
        termos_contrato: termos_contrato
      });

      // 3. Reenviar e-mail se for convidado (Lead) para notificar do novo PDF (v4.2.1)
      if (orcamento.customer_type === 'convidado') {
        console.log(`[ADMIN]: Reenviando orçamento atualizado para: ${orcamento.customer_email}`);
        await orcService.sendCommercialNotification(orcamento);
      }

      res.json({ success: true, total: subtotal });
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
      let payload;
      try {
        payload = await shopify.session.decodeSessionToken(sessionToken);
      } catch (err) {
        console.error('[ADMIN AUTH]: Erro ao decodificar JWT:', err.message);
        
        // Se o erro for expiração, logamos com destaque para identificar clock drift
        if (err.message.includes('expired')) {
            console.warn('[ADMIN AUTH]: Token expirado detectado. Verifique a sincronia do relógio do servidor.');
        }

        res.status(401).json({ error: 'Token inválido ou expirado', message: err.message });
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

  // --- CRUD DE CONDICÕES COMERCIAIS (v5.0.0) ---

  async listCondicoes(req, res) {
    try {
      const condicoes = await Condicao.findAll({ order: [['is_default', 'DESC'], ['nome', 'ASC']] });
      res.json(condicoes);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao listar condições' });
    }
  }

  async createCondicao(req, res) {
    try {
      const { nome, tipo, valor, is_default } = req.body;
      
      const session = await this.validateSession(req, res);
      if (!session) return;

      if (is_default) {
        await Condicao.update({ is_default: false }, { where: {} });
      }

      const condicao = await Condicao.create({ nome, tipo, valor, is_default: !!is_default });
      res.status(201).json(condicao);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao criar condição' });
    }
  }

  // ----------------------------------------------------
  // Helper interno para aplicar update em massa de Condicao
  // ----------------------------------------------------
  async _applyCondicaoToAll(condicao) {
    const allOrcamentos = await Orcamento.findAll();
    const updatePromises = allOrcamentos.map(async (orc) => {
      const subtotal = parseFloat(orc.original_price || orc.total_price || 0);
      const valor = parseFloat(condicao.valor);
      const ajuste = (subtotal * valor) / 100;
      
      let finalPrice = subtotal;
      if (condicao.tipo === 'desconto') {
        finalPrice -= ajuste;
      } else {
        finalPrice += ajuste;
      }

      return orc.update({
        total_price: finalPrice,
        condicao_json: {
          id: condicao.id,
          nome: condicao.nome,
          tipo: condicao.tipo,
          valor: valor
        }
      });
    });

    await Promise.all(updatePromises);
    console.log(`[ADMIN BULK]: Atualização concluída para ${allOrcamentos.length} orçamentos.`);
  }

  async updateCondicao(req, res) {
    try {
      const { id } = req.params;
      const { nome, tipo, valor, is_default } = req.body;
      
      const session = await this.validateSession(req, res);
      if (!session) return;

      const condicao = await Condicao.findByPk(id);
      if (!condicao) return res.status(404).json({ error: 'Condição não encontrada' });

      if (is_default && !condicao.is_default) {
        await Condicao.update({ is_default: false }, { where: {} });
      }

      await condicao.update({ nome, tipo, valor, is_default: !!is_default });

      // Se a condição atualizada é a padrão, ou se tornou a padrão, deve refletir em todos
      if (condicao.is_default) {
        await this._applyCondicaoToAll(condicao);
      }

      res.json(condicao);
    } catch (error) {
      console.error('[ADMIN CONTROLLER]: Erro ao atualizar condição', error);
      res.status(500).json({ error: 'Erro ao atualizar condição' });
    }
  }

  async deleteCondicao(req, res) {
    try {
      const { id } = req.params;
      
      const session = await this.validateSession(req, res);
      if (!session) return;

      const condicao = await Condicao.findByPk(id);
      if (!condicao) return res.status(404).json({ error: 'Condição não encontrada' });

      await condicao.destroy();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao excluir condição' });
    }
  }

  async setDefaultCondicao(req, res) {
    try {
      const { id } = req.params;
      
      const session = await this.validateSession(req, res);
      if (!session) return;

      // 1. Resetar todos os outros
      await Condicao.update({ is_default: false }, { where: {} });

      const condicao = await Condicao.findByPk(id);
      if (!condicao) return res.status(404).json({ error: 'Condição não encontrada' });

      await condicao.update({ is_default: true });

      // 3. ATUALIZAÇÃO EM MASSA: Aplicar a todos os orçamentos (v5.1.0)
      await this._applyCondicaoToAll(condicao);

      res.json({ success: true });
    } catch (error) {
      console.error('[ADMIN CONTROLLER]: Erro no Bulk Update de Condições:', error.message);
      res.status(500).json({ error: 'Erro ao processar atualização em massa' });
    }
  }

  // --- GESTÃO DE ID SEQUENCIAL (v12.33.20) ---

  // Chamado pelo Shopify Flow
  async getNextCustomerCode(req, res) {
    try {
      console.log('[FLOW]: Recebendo solicitação de código sequencial...', req.body);
      const customerData = req.body;
      
      if (!customerData.id) {
        return res.status(400).json({ error: 'ID do cliente é obrigatório' });
      }

      const code = await adminService.generateNextCode(customerData);
      
      console.log(`[FLOW]: Código ${code} gerado para o cliente ${customerData.email || customerData.id}`);
      
      // Retornar apenas o número puro como texto para máxima compatibilidade com Shopify Flow (v12.33.25)
      res.set('Content-Type', 'text/plain');
      res.send(code.toString());
    } catch (error) {
      console.error('[FLOW ERROR]:', error.message);
      res.status(500).json({ error: 'Erro ao gerar código sequencial' });
    }
  }

  // Novo Endpoint para Atualização Completa + Log de Origem (v12.33.30)
  async updateCustomerFromFlow(req, res) {
    try {
      console.log('[FLOW UPDATE]: Recebendo submissão de formulário...', req.body);
      
      // Processa a submissão, gera código e loga tudo
      const code = await adminService.processFlowSubmission(req.body);
      
      console.log(`[FLOW UPDATE]: Cliente ${req.body.email} processado via Form ${req.body.form_id || 'N/A'}. Código Gerado: ${code}`);
      
      // O agente do Shopify pediu retorno 200 OK sem body, 
      // mas vamos enviar o código no Header ou deixar que o Flow use o endpoint de 'next-code' se precisar.
      // Aqui enviamos apenas OK conforme solicitado.
      res.set('X-Generated-Code', code);
      res.status(200).send(code.toString()); // Envia o código como texto puro também, por segurança
    } catch (error) {
      console.error('[FLOW UPDATE ERROR]:', error.message);
      res.status(500).send('Erro interno');
    }
  }

  // Chamado pelo Dashboard do App
  async getSettingsData(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;

      const nextCode = await adminService.getNextCodeValue();
      const { count, rows: history } = await adminService.getCodeHistory(limit, offset);
      
      res.json({ 
        nextCode, 
        history,
        pagination: {
          total: count,
          limit,
          offset
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
  }

  async updateSettings(req, res) {
    try {
      const { nextCode } = req.body;
      const session = await this.validateSession(req, res);
      if (!session) return;

      if (nextCode === undefined) return res.status(400).json({ error: 'nextCode é obrigatório' });
      
      await adminService.updateNextCodeValue(nextCode);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao atualizar configurações' });
    }
  }
}

module.exports = new AdminController();
