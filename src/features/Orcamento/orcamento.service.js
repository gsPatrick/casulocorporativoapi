const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');
const { Resend } = require('resend');
const adminService = require('../Admin/admin.service');

class OrcamentoService {
  async createOrcamento(data) {
    const startService = Date.now();
    
    // 1. Resolução de Dados do Cliente (v12.80.0)
    let customerName = data.customer_metadata?.name || 
                        (data.customer_metadata?.first_name ? `${data.customer_metadata.first_name} ${data.customer_metadata.last_name || ''}`.trim() : null) ||
                        data.customer_name || 
                        (data.lead?.nome ? `${data.lead.nome} ${data.lead.sobrenome || ''}`.trim() : null);

    let customerEmail = data.customer_metadata?.email || data.customer_email || data.lead?.email || null;

    // Se houver um ID de cliente mas o nome for nulo (Fluxo B2B Profissional), buscamos no Shopify
    if (data.customer_id && (!customerName || customerName === 'Cliente Shopify')) {
      try {
        console.log(`[SERVICE B2B DEBUG]: Iniciando busca para ID: ${data.customer_id} na loja: ${data.shop}`);
        const shopifyAdmin = require('../../services/shopifyAdmin');
        const token = await shopifyAdmin.getAccessToken();
        const shop = data.shop || process.env.SHOPIFY_SHOP || 'casulo-concept.myshopify.com';
        
        const response = await fetch(`https://${shop}/admin/api/2024-04/customers/${data.customer_id}.json`, {
          headers: { 'X-Shopify-Access-Token': token }
        });
        
        if (response.ok) {
          const { customer } = await response.json();
          customerName = `${customer.first_name} ${customer.last_name || ''}`.trim();
          customerEmail = customerEmail || customer.email;
          data.customer_tags = (customer.tags || '').split(',').map(t => t.trim());
          console.log(`[SERVICE B2B DEBUG]: Shopify retornou: ${customerName} (Email: ${customerEmail})`);

          // Buscar Código do Cliente via Metafields (v12.90.0)
          try {
            const metaRes = await fetch(`https://${shop}/admin/api/2024-04/customers/${data.customer_id}/metafields.json`, {
              headers: { 'X-Shopify-Access-Token': token }
            });
            if (metaRes.ok) {
              const { metafields } = await metaRes.json();
              const codeMeta = metafields.find(m => m.namespace === 'custom' && m.key === 'codigo_do_cliente');
              if (codeMeta) {
                data.resolved_customer_code = codeMeta.value;
                console.log(`[SERVICE B2B]: Código do cliente recuperado: ${data.resolved_customer_code}`);
              }
            }
          } catch (e) {
            console.error('[SERVICE B2B ERROR]: Falha ao buscar metafields:', e.message);
          }
        } else {
          console.error(`[SERVICE B2B DEBUG]: Erro API Shopify: ${response.status}`);
        }
      } catch (err) {
        console.error('[SERVICE B2B ERROR]: Falha na pré-resolução do cliente:', err.message);
      }
    }

    customerName = customerName || (data.customer_id ? 'Cliente Shopify' : 'Visitante');

    // 2. Processamento de Itens e Snapshots
    const parsedItems = await this.parseItems(data.items);
    const originalPrice = this.calculateTotalPrice(parsedItems);
    
    const orcamentoId = require('crypto').randomUUID();
    const CartItem = require('../../models/CartItem');
    const enrichedItems = await Promise.all(parsedItems.map(async (item) => {
        const vid = item.variant_id?.toString();
        const pid = item.product_id?.toString();
        let synced = null;
        if (data.customer_id) synced = await CartItem.findOne({ where: { shopify_customer_id: data.customer_id.toString(), variant_id: vid } });
        if (!synced && data.browser_id) synced = await CartItem.findOne({ where: { browser_id: data.browser_id.toString(), variant_id: vid } });
        if (!synced && pid) {
          const pidCriteria = data.customer_id ? { shopify_customer_id: data.customer_id.toString(), product_id: pid } : { browser_id: data.browser_id.toString(), product_id: pid };
          synced = await CartItem.findOne({ where: pidCriteria, order: [['updatedAt', 'DESC']] });
        }
        if (synced && (synced.last_snapshot || synced.image_url)) return { ...item, custom_image: synced.last_snapshot || synced.image_url };
        return item;
    }));

    const { items: finalItems, base64Map } = this.extractBase64Images(enrichedItems, orcamentoId);

    // 3. Regras de Negócio (Vendedor, Condições, etc.)
    const Condicao = require('../../models/Condicao');
    const condicaoPadrao = await Condicao.findOne({ where: { is_default: true } });
    
    let subtotal = originalPrice;
    let condicaoJson = null;

    if (condicaoPadrao) {
      const valorCondicao = parseFloat(condicaoPadrao.valor);
      const ajuste = (subtotal * valorCondicao) / 100;
      if (condicaoPadrao.tipo === 'desconto') subtotal -= ajuste;
      else if (condicaoPadrao.tipo === 'acréscimo') subtotal += ajuste;
      condicaoJson = { id: condicaoPadrao.id, nome: condicaoPadrao.nome, tipo: condicaoPadrao.tipo, valor: valorCondicao };
    }
    
    const { vendedor, parceiro } = this.parseBusinessTags(data.customer_tags || []);
    const finalOriginalPrice = data.original_total_price ? parseFloat(data.original_total_price) : originalPrice;
    const finalLiquidPrice = data.total_price ? parseFloat(data.total_price) : subtotal;

    const metadata = data.customer_metadata?.metafields?.custom || {};
    const customerCode = data.resolved_customer_code || metadata.codigo_do_cliente || (data.lead?.registration_type === 'b2b_completion' ? data.lead.codigo_cliente : null);
    const shortCode = await this.generateShortCode(customerCode);
    
    const year2Digits = new Date().getFullYear().toString().slice(-2);
    const seq = await adminService.generateNextProposalSequence();
    const customId = `${customerCode || 'GUEST'}${year2Digits}${seq}`;
    const expirationMinutes = await adminService.getExpirationMinutes();
    
    console.log(`[SERVICE B2B FINAL CHECK]: Cliente=${customerName}, Consultor=${data.consultor_name}, Especificador=${data.especificador_name}`);

    // 4. Persistência
    const orcamento = await Orcamento.create({
      id: orcamentoId,
      shopify_customer_id: data.customer_id ? data.customer_id.toString() : null,
      customer_type: data.customer_id ? 'logado' : 'convidado',
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: data.customer_phone || data.lead?.whatsapp || data.customer_metadata?.phone || null,
      lead_json: data.lead || null,
      line_items_json: finalItems,
      total_price: finalLiquidPrice,
      original_price: finalOriginalPrice,
      short_code: shortCode,
      custom_id: customId,
      sequence_number: seq,
      vendedor,
      parceiro,
      customer_tags: data.customer_tags || [],
      status: 'analise',
      condicao_json: condicaoJson,
      customer_cnpj: metadata.cnpj || data.lead?.cnpj || null,
      customer_company: metadata.empresa || data.lead?.empresa || null,
      customer_address: metadata.endereco || data.lead?.endereco || null,
      customer_cep: metadata.cep || data.lead?.cep || null,
      customer_code: customerCode,
      expiration_minutes: expirationMinutes,
      consultor_id: data.consultor_id || null,
      consultor_name: data.consultor_name || null,
      especificador_id: data.especificador_id || null,
      especificador_name: data.especificador_name || null
    });
    
    console.log(`[SERVICE SUCCESS]: Orçamento #${orcamento.id} criado com sucesso em ${Date.now() - startService}ms`);

    // 2. Processar tarefas secundárias em Segundo Plano (Background)
    this.processPostCreationTasks(orcamento, base64Map).catch(err => {
      console.error(`[${new Date().toISOString()}] [SERVICE ERROR]:`, err.message);
    });

    // 3. Limpeza do Carrinho Virtual (v3.9.0)
    if (data.customer_id) {
      console.log(`[SERVICE]: Limpando itens sincronizados para o cliente ${data.customer_id}`);
      CartItem.destroy({ where: { shopify_customer_id: data.customer_id.toString() } }).catch(e => {
        console.error('[SERVICE ERROR]: Falha ao limpar CartItem:', e.message);
      });
    }

    return orcamento;
  }

  async processPostCreationTasks(orcamento, base64Map = {}) {
    // 0. Salvar imagens (Base64 ou URL) no disco
    if (Object.keys(base64Map).length > 0) {
      await this.processImagesMap(base64Map, orcamento.id);
    }

    // A. Sincronizar com Shopify Metaobjects
    try {
      const metaobjectRef = await this.syncWithShopifyMetaobject(orcamento);
      await orcamento.update({ pdf_url: metaobjectRef });
    } catch (error) {
      console.error('Falha na sincronização com Metaobjects:', error.message);
    }

    // B. Notificação Comercial (E-mail) - Apenas para Convidados/Leads (v4.2.1)
    if (orcamento.customer_type === 'convidado') {
      try {
        await this.sendCommercialNotification(orcamento);
      } catch (error) {
        console.error('Falha ao enviar e-mail de notificação:', error.message);
      }
    }
  }

  async sendCommercialNotification(orcamento) {
    const resend = new Resend('re_ZffJc6jB_bi9qLaMVVSUYuDaVy48XDf7n');

    const isLead = !orcamento.shopify_customer_id && orcamento.lead_json;
    const clientInfo = isLead 
      ? `Lead: ${orcamento.lead_json.nome} (${orcamento.lead_json.whatsapp})` 
      : `Cliente Shopify ID: ${orcamento.shopify_customer_id}`;

    let baseUrl = process.env.APP_URL || 'https://casulo-backend.herokuapp.com'; // Fallback para URL de produção
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    const pdfLink = `${baseUrl}/api/orcamento/${orcamento.id}/pdf`;

    const fromEmail = 'Casulo Corporativa <contato@casulocorporativo.com.br>'; 
    const toEmail = ['comercial@casulocorporativo.com.br', 'patrickgsiqueria@hotmail.com', 'patricksiqueira.developer@gmail.com'];

    const htmlContent = `
        <div style="font-family: 'Inter', sans-serif; color: #111; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 30px;">
            <h2 style="text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #000; padding-bottom: 10px;">Nova Solicitação de Orçamento</h2>
            <p style="font-size: 14px; margin-top: 20px;"><strong>ID da Proposta:</strong> #${orcamento.id.substring(0, 8).toUpperCase()}</p>
            <p style="font-size: 14px;"><strong>Origem:</strong> ${clientInfo}</p>
            <p style="font-size: 14px;"><strong>E-mail do Cliente:</strong> ${orcamento.lead_json?.email || orcamento.customer_email || 'N/A'}</p>
            
            <div style="background: #f9f9f9; padding: 15px; border-radius: 4px; margin: 25px 0;">
                <p style="margin: 0; font-weight: bold; color: #814620;">📎 A proposta completa em PDF está em anexo a este e-mail.</p>
            </div>

            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="font-size: 13px; font-weight: bold; text-transform: uppercase;">Resumo dos Itens:</p>
            ${orcamento.line_items_json.map(item => `
              <div style="margin-bottom: 15px; border-bottom: 1px solid #f5f5f5; padding-bottom: 15px; display: flex; gap: 15px; align-items: center;">
                ${item.custom_image ? `<img src="${item.custom_image}" width="80" height="80" style="border: 1px solid #eee; object-fit: cover;" />` : ''}
                <div>
                    <p style="margin: 0; font-weight: bold; font-size: 14px;">${item.title || item.product_id}</p>
                    <p style="margin: 5px 0 0; font-size: 12px; color: #888;">Qtd: <strong>${item.quantity || 1}</strong></p>
                    ${item.especificacao_generica ? `
                    <p style="margin: 5px 0 0; font-size: 11px; color: #814620; background: #fff8e1; padding: 4px 8px; border-radius: 4px; display: inline-block;">
                      <strong>Configuração:</strong> ${item.especificacao_generica}
                    </p>` : ''}
                </div>
              </div>
            `).join('')}
            
            <div style="margin-top: 40px; text-align: center;">
                <a href="${pdfLink}" style="background: #000; color: #fff; text-decoration: none; padding: 12px 25px; font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Acessar no Painel Admin</a>
            </div>
        </div>
    `;

    // C. Gerar PDF para anexo
    let pdfBuffer = null;
    try {
      const pdfService = require('./pdf.service');
      pdfBuffer = await pdfService.getOrcamentoPDFBuffer(orcamento);
      console.log(`[SERVICE]: Buffer de PDF gerado com sucesso para anexo (${pdfBuffer.length} bytes)`);
    } catch (err) {
      console.error('[SERVICE]: Falha ao gerar buffer do PDF para anexo:', err.message);
    }

    try {
      const data = await resend.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `[B2B] Novo Orçamento: ${orcamento.customer_name} (#${orcamento.id.substring(0, 8).toUpperCase()})`,
        html: htmlContent,
        attachments: pdfBuffer ? [
          {
            filename: `Proposta_Comercial_${orcamento.short_code || orcamento.id.substring(0, 8)}.pdf`,
            content: pdfBuffer.toString('base64'),
            contentType: 'application/pdf'
          }
        ] : []
      });
      console.log('[RESEND]: Orçamento enviado com sucesso via Resend API (com anexo real).', data);
      return data;
    } catch (error) {
      console.error('[RESEND ERROR]: Erro ao enviar notificação comercial:', error);
    }
  }

  async parseItems(items) {
    if (!Array.isArray(items)) return [];
    
    const axios = require('axios');
    const shopifyAdminService = require('../../services/shopifyAdmin');
    const accessToken = await shopifyAdminService.getAccessToken();
    const shop = process.env.SHOPIFY_HOST_NAME || '9bf7e4-75.myshopify.com';

    return await Promise.all(items.map(async (item) => {
      let especificacao_generica = item.especificacao_generica || null;
      let product_description = item.product_description || '';
      let metafields_data = {};

      // Buscar Dados do Produto e Metafields no Shopify via API
      if (item.product_id && accessToken) {
        try {
          const productId = item.product_id.toString().replace('gid://shopify/Product/', '');
          console.log(`[ORCAMENTO SERVICE]: Buscando dados no Shopify para Produto ${productId}...`);
          
          // 1. Buscar Produto (para descrição)
          const productRes = await axios({
            url: `https://${shop}/admin/api/2024-01/products/${productId}.json`,
            method: 'GET',
            headers: { 'X-Shopify-Access-Token': accessToken }
          });
          product_description = productRes.data.product.body_html || '';
          console.log(`[ORCAMENTO SERVICE]: Descrição recuperada para ${productId}`);

          // 2. Buscar Metafields
          const metafieldsRes = await axios({
            url: `https://${shop}/admin/api/2024-01/products/${productId}/metafields.json`,
            method: 'GET',
            headers: { 'X-Shopify-Access-Token': accessToken }
          });

          metafieldsRes.data.metafields.forEach(m => {
            if (m.namespace === 'custom') {
               metafields_data[m.key] = m.value;
            }
          });
          
          if (metafields_data.especificacao_generica) {
            especificacao_generica = metafields_data.especificacao_generica;
            console.log(`[ORCAMENTO SERVICE]: Especificação Genérica encontrada para ${productId}`);
          }
        } catch (error) {
          console.error(`[ORCAMENTO SERVICE ERROR]: Falha ao buscar dados do produto ${item.product_id}:`, error.response?.status || error.message);
        }
      }

      // Função para limpar repetições de texto (Ex: "Texto Texto Texto" -> "Texto")
      const cleanRepetition = (str) => {
        if (!str || typeof str !== 'string') return str;
        const trimmed = str.trim();
        // Tenta detectar se a string inteira é composta por 2 ou mais repetições de um mesmo bloco longo
        const half = Math.floor(trimmed.length / 2);
        for (let i = 10; i <= half; i++) {
           const pattern = trimmed.substring(0, i);
           const remaining = trimmed.substring(i).trim();
           if (remaining.startsWith(pattern.trim())) {
              // Se o padrão se repete logo em seguida, assumimos duplicação e pegamos a primeira parte
              // Mas apenas se for um padrão razoavelmente longo ( > 10 chars)
              const parts = trimmed.split(pattern.trim()).filter(p => p.trim().length > 0);
              if (parts.length === 0 || parts.every(p => p.trim() === '')) return pattern.trim();
           }
        }
        return trimmed;
      };

      const parsedItem = {
        type: item.type || 'standard',
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        title: item.title || 'Produto',
        technical_specification: item.technical_specification || '',
        especificacao_generica: cleanRepetition(item.especificacao_generica || especificacao_generica),
        product_description: product_description,
        metafields: metafields_data,
        price: item.price || 0,
        additional_info: item.additional_info || '',
        custom_image: item.custom_image || null,
        configuration_url: item.configuration_url || null,
        customizer_state: item.customizer_state || {},
        quantity: item.quantity || 1
      };

      return parsedItem;
    }));
  }

  calculateTotalPrice(items) {
    let total = 0;
    items.forEach(item => {
      const itemPrice = parseFloat(item.price || 0);
      total += itemPrice * (item.quantity || 1);
    });
    return total;
  }

  async getOrcamentosByCustomer(customerId, options = {}) {
    const { Op } = require('sequelize');
    const limit = parseInt(options.limit) || 10;
    const page = parseInt(options.page) || 1;
    const offset = (page - 1) * limit;
    const statusFilter = options.status;
    const roleFilter = options.role;

    const where = { 
      hidden_for_customer: false
    };

    if (roleFilter === 'cliente') {
      where.shopify_customer_id = customerId.toString();
    } else if (roleFilter === 'consultor') {
      where.consultor_id = customerId.toString();
    } else if (roleFilter === 'especificador') {
      where.especificador_id = customerId.toString();
    } else {
      where[Op.or] = [
        { shopify_customer_id: customerId.toString() },
        { consultor_id: customerId.toString() },
        { especificador_id: customerId.toString() }
      ];
    }

    // --- B2B Visibility Logic ---
    let isAprovado = false;
    let isRestritoOuTemporario = false;

    try {
      const shopifyAdmin = require('../../services/shopifyAdmin');
      const token = await shopifyAdmin.getAccessToken();
      const shop = process.env.SHOPIFY_SHOP || 'casulo-concept.myshopify.com';
      
      const response = await fetch(`https://${shop}/admin/api/2024-04/customers/${customerId}.json`, {
        headers: { 'X-Shopify-Access-Token': token }
      });
      
      if (response.ok) {
        const { customer } = await response.json();
        const tags = (customer.tags || '').toLowerCase();
        isAprovado = tags.includes('aprovado');
        isRestritoOuTemporario = tags.includes('acesso-restrito') || tags.includes('acesso_temporario') || tags.includes('acesso-temporario');
      }
    } catch (e) {
      console.error('[SERVICE B2B ERROR]: Falha ao buscar tags do cliente para listagem:', e.message);
    }

    if (statusFilter && statusFilter !== 'todos') {
      where.status = statusFilter;
      // Se for restrito/temporário e tentou filtrar um status diferente de aprovado, e não é aprovado
      if (!isAprovado && isRestritoOuTemporario && statusFilter !== 'aprovado') {
        where.status = 'none_match_rule'; // Hack to return empty array
      }
    } else {
      if (isAprovado) {
        where.status = { [Op.in]: ['aprovado', 'finalizado', 'enviado', 'cancelado', 'pendente', 'analise', 'expirado'] };
      } else if (isRestritoOuTemporario) {
        where.status = 'aprovado'; // Só vê se o admin já aprovou
      } else {
        where.status = { [Op.in]: ['aprovado', 'finalizado', 'enviado', 'cancelado', 'pendente', 'analise', 'expirado'] };
      }
    }
    // ----------------------------

    const { count, rows } = await Orcamento.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    const expirationMinutes = await adminService.getExpirationMinutes();
    const expirationMs = expirationMinutes * 60 * 1000;
    const now = new Date().getTime();

    const data = rows.map(row => {
      const p = typeof row.get === 'function' ? row.get({ plain: true }) : row;
      const createdTime = new Date(p.createdAt).getTime();
      const specificMs = p.expiration_minutes !== null && p.expiration_minutes !== undefined 
                           ? p.expiration_minutes * 60 * 1000 
                           : expirationMs;
      const expiresAt = new Date(createdTime + specificMs);
      
      // Override status for expired ones se eram pendente/analise/enviado
      if (now > expiresAt.getTime() && ['pendente', 'analise', 'enviado'].includes(p.status)) {
        p.status = 'expirado';
        // Persistir no banco para que uma mudança global de validade futura não ressuscite a proposta (v5.6.0)
        Orcamento.update({ status: 'expirado' }, { where: { id: p.id } }).catch(e => console.error('[EXPIRATION SYNC ERROR]', e));
      }
      p.expiresAt = expiresAt.toISOString();
      return p;
    });

    return {
      total: count,
      pages: Math.ceil(count / limit),
      currentPage: page,
      data: data
    };
  }

  async updateOrcamento(id, customerId, data) {
    const { Op } = require('sequelize');
    const orcamento = await Orcamento.findOne({ 
      where: { 
        id: id,
        [Op.or]: [
          { shopify_customer_id: customerId.toString() },
          { consultor_id: customerId.toString() },
          { especificador_id: customerId.toString() }
        ]
      } 
    });
    
    if (!orcamento) throw new Error('Orçamento não encontrado');
    if (!['pendente', 'analise', 'aprovado'].includes(orcamento.status)) {
      throw new Error('Esta proposta não pode mais ser editada neste status.');
    }

    await orcamento.update({
      line_items_json: data.line_items_json,
      total_price: data.total_price || orcamento.total_price,
      status: 'analise'
    });
    
    return orcamento;
  }

  async submitOrcamento(id, customerId) {
    const { Op } = require('sequelize');
    const orcamento = await Orcamento.findOne({ 
      where: { 
        id: id,
        [Op.or]: [
          { shopify_customer_id: customerId.toString() },
          { consultor_id: customerId.toString() },
          { especificador_id: customerId.toString() }
        ]
      } 
    });
    
    if (!orcamento) throw new Error('Orçamento não encontrado');
    if (!['pendente', 'analise'].includes(orcamento.status)) throw new Error('Esta proposta já foi enviada ou está em outro estado.');

    await orcamento.update({ status: 'analise' });
    return orcamento;
  }

  async cancelOrcamento(id, customerId) {
    const { Op } = require('sequelize');
    const orcamento = await Orcamento.findOne({ 
      where: { 
        id: id,
        [Op.or]: [
          { shopify_customer_id: customerId.toString() },
          { consultor_id: customerId.toString() },
          { especificador_id: customerId.toString() }
        ]
      } 
    });
    
    if (!orcamento) throw new Error('Orçamento não encontrado');
    
    // Só permite cancelar se estiver em estados iniciais ou aprovado
    if (!['pendente', 'analise', 'aprovado', 'enviado'].includes(orcamento.status)) {
        throw new Error('Esta proposta não pode mais ser cancelada neste status.');
    }

    await orcamento.update({ status: 'cancelado' });
    return orcamento;
  }

  async hideOrcamento(id, customerId) {
    const { Op } = require('sequelize');
    const orcamento = await Orcamento.findOne({ 
      where: { 
        id: id,
        [Op.or]: [
          { shopify_customer_id: customerId.toString() },
          { consultor_id: customerId.toString() },
          { especificador_id: customerId.toString() }
        ]
      } 
    });
    
    if (!orcamento) throw new Error('Orçamento não encontrado');
    
    await orcamento.update({ hidden_for_customer: true });
    return { success: true };
  }

  async getOrcamentoById(id) {
    return await Orcamento.findByPk(id);
  }

  async syncWithShopifyMetaobject(orcamento) {
    const variables = {
      metaobject: {
        type: 'orcamento',
        fields: [
          { key: 'customer_id', value: orcamento.shopify_customer_id || 'guest' },
          { key: 'customer_name', value: orcamento.customer_name },
          { key: 'customer_email', value: orcamento.customer_email || '' },
          { key: 'customer_type', value: orcamento.customer_type || 'convidado' },
          { key: 'total_price', value: orcamento.total_price.toString() },
          { key: 'configuration_summary', value: JSON.stringify(orcamento.line_items_json) }
        ]
      }
    };

    console.log('Sincronizando orçamentos com Shopify Metaobjects...', orcamento.id);
    return `gid://shopify/Metaobject/mock-${orcamento.id.substring(0,8)}`;
  }

  /**
   * Salva as imagens após a criação (Endpoint tardio para evitar timeout 504 no App Proxy)
   */
  async saveBase64ImagesAfterCreation(orcamentoId, base64Map) {
    // 1. Salva os arquivos no disco (Suporta Base64 e URL agora)
    await this.processImagesMap(base64Map, orcamentoId);
    
    // 2. Garante que o DB tem os links
    const orcamento = await Orcamento.findByPk(orcamentoId);
    if (!orcamento) {
      console.error(`[SERVICE]: Orçamento ${orcamentoId} não encontrado para upload tardio.`);
      return;
    }
    
    let needsUpdate = false;
    const updatedItems = orcamento.line_items_json.map((item, index) => {
      if (base64Map[index] && !item.custom_image?.includes('/images/')) {
         needsUpdate = true;
         return {
           ...item,
           custom_image: `/apps/orcamento/images/${orcamentoId}/${index}`
         };
      }
      return item;
    });
    
    if (needsUpdate) {
      await orcamento.update({ line_items_json: updatedItems });
      console.log(`[SERVICE]: DB atualizado com links de imagem para Orçamento ${orcamentoId}`);
    }
  }

  /**
   * Extrai Base64 dos itens para processamento em background (Bypass 504 Timeout)
   */
  extractBase64Images(items, orcamentoId) {
    const base64Map = {};
    let appUrl = process.env.APP_URL || 'https://sua-api.com';
    if (appUrl.endsWith('/')) appUrl = appUrl.slice(0, -1);
    
    const finalItems = items.map((item, index) => {
      if (item.custom_image && (item.custom_image.startsWith('data:image') || item.custom_image.startsWith('http'))) {
        base64Map[index] = item.custom_image;
        return {
          ...item,
          custom_image: `${appUrl}/api/orcamento/images/${orcamentoId}/${index}`
        };
      }
      return item;
    });
    return { items: finalItems, base64Map };
  }

  /**
   * Processa o mapa de imagens, baixando URLs ou salvando Base64
   */
  async processImagesMap(base64Map, orcamentoId) {
    const fs = require('fs');
    const path = require('path');
    const axios = require('axios');
    const sharp = require('sharp'); // Biblioteca para Autocrop
    const imagesDir = path.join(__dirname, '../../temp/images');
    
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
 
    const promises = Object.keys(base64Map).map(async (index) => {
      const data = base64Map[index];
      if (!data) return;
 
      const fileName = `snapshot-${orcamentoId}-${index}.png`;
      const filePath = path.join(imagesDir, fileName);
 
      try {
        let buffer;
        if (data.startsWith('data:image')) {
          // É Base64 puro
          const base64Data = data.replace(/^data:image\/\w+;base64,/, "");
          buffer = Buffer.from(base64Data, 'base64');
        } else if (data.startsWith('http')) {
          // É uma URL externa (Snapshot do Angle3D)
          console.log(`[ORCAMENTO SERVICE]: Baixando imagem externa: ${data}`);
          const response = await axios.get(data, { 
            responseType: 'arraybuffer',
            timeout: 10000 // 10s timeout solicitado pelo usuário
          });
          buffer = Buffer.from(response.data, 'binary');
        } else {
          console.warn(`[ORCAMENTO SERVICE]: Formato de imagem desconhecido para item ${index}`);
          return;
        }

        // --- APLICAÇÃO DO AUTOCROP (TRIM) ---
        console.log(`[ORCAMENTO SERVICE]: Aplicando Autocrop na imagem ${fileName}...`);
        const croppedBuffer = await sharp(buffer)
          .trim() // Remove bordas de cor sólida (branco ou transparente)
          .toBuffer();
 
        fs.writeFileSync(filePath, croppedBuffer);
        
        if (fs.existsSync(filePath)) {
          console.log(`[ORCAMENTO SERVICE]: ✅ Imagem salva com sucesso: ${fileName} (${croppedBuffer.length} bytes)`);
        } else {
          console.error(`[ORCAMENTO SERVICE]: ❌ Falha ao verificar arquivo salvo: ${fileName}`);
        }
        
        let appUrl = process.env.APP_URL || 'http://localhost:3000';
        if (appUrl.endsWith('/')) appUrl = appUrl.slice(0, -1);
        console.log(`[ORCAMENTO SERVICE]: Imagem salva e trimmada: ${fileName} (${croppedBuffer.length} bytes)`);
      } catch (err) {
        console.error(`[ORCAMENTO SERVICE]: Falha ao processar imagem ${index} (${data.substring(0, 30)}...):`, err.message);
      }
    });
 
    await Promise.all(promises);
  }

  // --- MÉTODOS DE NEGÓCIO FASE 1 ---

  parseBusinessTags(tagsArray) {
    const tags = Array.isArray(tagsArray) ? tagsArray : (typeof tagsArray === 'string' ? tagsArray.split(',').map(t => t.trim()) : []);
    
    let vendedor = null;
    let parceiro = null;
    const customerTags = [];

    tags.forEach(tag => {
      if (tag.startsWith('vendedor:')) {
        vendedor = tag.replace('vendedor:', '').trim();
      } else if (tag.startsWith('parceiro:')) {
        parceiro = tag.replace('parceiro:', '').trim();
      } else {
        customerTags.push(tag.toLowerCase());
      }
    });

    return { vendedor, parceiro, customerTags };
  }

  async syncB2BCustomerData(customerId, leadData) {
    const axios = require('axios');
    const shopifyAdminService = require('../../services/shopifyAdmin');
    const shop = process.env.SHOPIFY_HOST_NAME || '9bf7e4-75.myshopify.com';
    const accessToken = await shopifyAdminService.getAccessToken(); 

    if (!accessToken) {
       console.error('[SERVICE B2B ERROR]: Não foi possível obter o Access Token do Shopify.');
       return;
    }

    const gid = customerId.toString().startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;
    
    // 1. ATUALIZAR TAGS (GraphQL)
    // Remove acesso_temporario e adiciona acesso-restrito
    const queryTags = `
      mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id tags }
          userErrors { field message }
        }
      }
    `;

    try {
      // Primeiro buscamos as tags atuais para fazer o swap limpo
      const getTagsQuery = `query { customer(id: "${gid}") { tags } }`;
      const resTags = await axios({
        url: `https://${shop}/admin/api/2024-01/graphql.json`,
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        data: { query: getTagsQuery }
      });

      const currentTags = resTags.data.data.customer?.tags || [];
      const newTags = currentTags
        .filter(t => t.toLowerCase() !== 'acesso_temporario')
        .concat(['acesso-restrito']);

      await axios({
        url: `https://${shop}/admin/api/2024-01/graphql.json`,
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        data: {
          query: queryTags,
          variables: { input: { id: gid, tags: newTags } }
        }
      });
      console.log(`[SERVICE B2B]: Tags atualizadas para o cliente ${customerId}`);

      // 2. ATUALIZAR METAFIELDS (GraphQL)
      const queryMetafields = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id key value }
            userErrors { field message }
          }
        }
      `;

      const metafields = [
        { ownerId: gid, namespace: 'custom', key: 'cnpj', value: leadData.cnpj || '', type: 'single_line_text_field' },
        { ownerId: gid, namespace: 'custom', key: 'cep', value: leadData.cep || '', type: 'single_line_text_field' },
        { ownerId: gid, namespace: 'custom', key: 'endereco', value: leadData.endereco || '', type: 'single_line_text_field' },
        { ownerId: gid, namespace: 'custom', key: 'empresa', value: leadData.empresa || '', type: 'single_line_text_field' }
      ].filter(m => m.value !== '');

      if (metafields.length > 0) {
        await axios({
          url: `https://${shop}/admin/api/2024-01/graphql.json`,
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
          data: {
            query: queryMetafields,
            variables: { metafields }
          }
        });
        console.log(`[SERVICE B2B]: Metafields sincronizados para o cliente ${customerId}`);
      }
    } catch (err) {
      console.error('[SERVICE B2B INFO]: Erro na comunicação com a Shopify:', err.response?.data || err.message);
    }
  }

  async generateShortCode(customerCode) {
    const { Op } = require('sequelize');
    const year = new Date().getFullYear();
    
    // 1. Definir Prefixo
    const prefix = customerCode ? customerCode.toString().toUpperCase() : 'CAS';
    
    // 2. Calcular Sequencial do Ano Atual
    const count = await Orcamento.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(`${year}-01-01`),
          [Op.lt]: new Date(`${year + 1}-01-01`)
        }
      }
    });

    const sequential = (count + 1).toString().padStart(4, '0');
    
    // 3. Montar Código: PREFIXO + ANO + SEQUENCIAL
    let code = `${prefix}${year}${sequential}`;
    
    // 4. Verificação de Unicidade
    let finalCode = code;
    let exists = await Orcamento.findOne({ where: { short_code: finalCode } });
    let retry = 1;
    
    while (exists) {
      finalCode = `${code}_${retry}`;
      exists = await Orcamento.findOne({ where: { short_code: finalCode } });
      retry++;
    }
    
    return finalCode;
  }

  async getOrcamentoByShortCode(code) {
    return await Orcamento.findOne({ where: { short_code: code } });
  }

  async updateCustomerProfile(customerId, data) {
    const axios = require('axios');
    const shopAdmin = require('../../services/shopifyAdmin');
    const accessToken = await shopAdmin.getAccessToken();
    const shop = process.env.SHOPIFY_SHOP || 'casulo-concept.myshopify.com';

    const gid = customerId.toString().startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;

    const metafields = [];
    if (data.cnpj !== undefined) metafields.push({ namespace: 'custom', key: 'cnpj', type: 'single_line_text_field', value: String(data.cnpj || '') });
    if (data.empresa !== undefined) metafields.push({ namespace: 'custom', key: 'empresa', type: 'single_line_text_field', value: String(data.empresa || '') });
    if (data.endereco !== undefined) metafields.push({ namespace: 'custom', key: 'endereco', type: 'single_line_text_field', value: String(data.endereco || '') });
    if (data.cep !== undefined) metafields.push({ namespace: 'custom', key: 'cep', type: 'single_line_text_field', value: String(data.cep || '') });

    const input = { id: gid };
    if (data.firstName !== undefined) input.firstName = String(data.firstName || '');
    if (data.lastName !== undefined) input.lastName = String(data.lastName || '');
    
    let cleanPhone = String(data.phone || '').trim();
    if (cleanPhone && !cleanPhone.startsWith('+')) {
      const digits = cleanPhone.replace(/[^\d]/g, '');
      if (digits.length >= 10) cleanPhone = '+55' + digits;
      else cleanPhone = null;
    }
    if (cleanPhone) input.phone = cleanPhone;

    if (metafields.length > 0) input.metafields = metafields;

    const mutation = `
      mutation customerUpdate($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id firstName lastName phone }
          userErrors { field message }
        }
      }
    `;

    const res = await axios({
      url: `https://${shop}/admin/api/2024-04/graphql.json`,
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      data: { query: mutation, variables: { input } }
    });

    if (res.data.errors) {
      console.error('[GRAPHQL ERRORS]:', JSON.stringify(res.data.errors));
      throw new Error('Erro na comunicação com a API do Shopify.');
    }

    const userErrors = res.data.data?.customerUpdate?.userErrors || [];
    if (userErrors.length > 0) {
      console.error('[CUSTOMER UPDATE ERRORS]:', JSON.stringify(userErrors));
      throw new Error(userErrors[0].message || 'Erro ao atualizar dados do cliente no Shopify.');
    }

    return { success: true };
  }
}

module.exports = new OrcamentoService();
