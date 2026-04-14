const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');
const { Resend } = require('resend');

class OrcamentoService {
  async createOrcamento(data) {
    const startService = Date.now();
    const parsedItems = await this.parseItems(data.items);
    const originalPrice = this.calculateTotalPrice(parsedItems);
    
    // Novas Regras de Negócio: Descontos e Tags (v4.0.0)
    const { vendedor, parceiro, customerTags: parsedTags } = this.parseBusinessTags(data.customer_tags || []);
    const orderCount = parseInt(data.customer_order_count || 0);
    
    const finalOriginalPrice = data.original_total_price ? parseFloat(data.original_total_price) : originalPrice;
    const finalLiquidPrice = data.total_price ? parseFloat(data.total_price) : originalPrice;
    const finalDiscountAmount = 0;
    
    const shortCode = await this.generateShortCode();

    // 1. Persistir no Postgres
    
    // Bypass Shopify 504 Timeout: Extraímos os Base64 pesados para processar em segundo plano
    const orcamentoId = require('crypto').randomUUID();
    const CartItem = require('../../models/CartItem');
    const enrichedItems = await Promise.all(parsedItems.map(async (item) => {
        const vid = item.variant_id?.toString();
        const pid = item.product_id?.toString();
        
        console.log(`[SERVICE DEBUG]: Buscando snapshot - Variant: ${vid}, Product: ${pid}, CID: ${data.customer_id}, BID: ${data.browser_id}`);
        
        let synced = null;
        
        // 1. Tenta por Variant ID (Configuração Exata)
        if (data.customer_id) {
          synced = await CartItem.findOne({ where: { shopify_customer_id: data.customer_id.toString(), variant_id: vid } });
        }
        if (!synced && data.browser_id) {
          synced = await CartItem.findOne({ where: { browser_id: data.browser_id.toString(), variant_id: vid } });
        }

        // 2. Fallback por Product ID (A customização mais recente deste produto para este usuário)
        if (!synced && pid) {
          const pidCriteria = data.customer_id ? { shopify_customer_id: data.customer_id.toString(), product_id: pid } : { browser_id: data.browser_id.toString(), product_id: pid };
          synced = await CartItem.findOne({ where: pidCriteria, order: [['updatedAt', 'DESC']] });
        }
        
        if (synced && (synced.last_snapshot || synced.image_url)) {
          console.log(`[SERVICE SUCCESS]: Snapshot recuperado para ${item.title} (Fallback: ${!synced.variant_id.includes(vid)})`);
          return { ...item, custom_image: synced.last_snapshot || synced.image_url };
        }
        
        console.log(`[SERVICE INFO]: Nenhum snapshot encontrado para ${item.title}`);
        return item;
    }));

    const { items: finalItems, base64Map } = this.extractBase64Images(enrichedItems, orcamentoId);
    console.log(`[${new Date().toISOString()}] [SERVICE]: Extração de Base64 concluída em ${Date.now() - startService}ms`);

    const dbStart = Date.now();
    const orcamento = await Orcamento.create({
      id: orcamentoId,
      shopify_customer_id: data.customer_id ? data.customer_id.toString() : null,
      customer_type: data.customer_id ? 'logado' : 'convidado',
      customer_name: data.customer_name || (data.lead?.nome ? `${data.lead.nome} ${data.lead.sobrenome || ''}`.trim() : null) || (data.customer_id ? 'Cliente Shopify' : 'Visitante'),
      customer_email: data.customer_email || data.lead?.email || null,
      customer_phone: data.customer_phone || data.lead?.whatsapp || null,
      lead_json: data.lead || null,
      line_items_json: finalItems,
      total_price: finalLiquidPrice,
      original_price: finalOriginalPrice,
      discount_amount: 0,
      discount_category: null,
      short_code: shortCode,
      vendedor,
      parceiro,
      customer_tags: data.customer_tags || [],
      status: 'pendente'
    });
    console.log(`[${new Date().toISOString()}] [SERVICE]: Escrita no Postgres concluída em ${Date.now() - dbStart}ms (Total: ${Date.now() - startService}ms)`);

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
                    <p style="margin: 5px 0 0; font-size: 12px; color: #666;">Qtd: ${item.quantity || 1} | ${item.technical_specification || 'Sem especificações'}</p>
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
    const shop = process.env.SHOPIFY_SHOP || 'casulo-corporativa.myshopify.com';
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_API_SECRET; // Usando o que estiver disponível

    return await Promise.all(items.map(async (item) => {
      let especificacao_generica = null;

      // Buscar Metafield do Shopify se houver product_id
      if (item.product_id && accessToken) {
        try {
          const productId = item.product_id.toString().replace('gid://shopify/Product/', '');
          const response = await axios({
            url: `https://${shop}/admin/api/2024-01/products/${productId}/metafields.json`,
            method: 'GET',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            }
          });

          // Filtrar pelo namespace e key solicitados
          const metafield = response.data.metafields.find(m => m.namespace === 'custom' && m.key === 'especificacao_generica');
          if (metafield) {
            especificacao_generica = metafield.value;
          }
        } catch (error) {
          console.error(`[PDF SERVICE]: Falha ao buscar metafield para produto ${item.product_id}:`, error.message);
        }
      }

      const parsedItem = {
        type: item.type || 'standard',
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        title: item.title || 'Produto',
        technical_specification: item.technical_specification || '',
        especificacao_generica: item.especificacao_generica || especificacao_generica,
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

  async getOrcamentosByCustomer(customerId) {
    return await Orcamento.findAll({
      where: { shopify_customer_id: customerId },
      order: [['createdAt', 'DESC']]
    });
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
    const shop = process.env.SHOPIFY_HOST_NAME || 'casulo-corporativa.myshopify.com';
    const accessToken = process.env.SHOPIFY_API_SECRET;

    if (!accessToken) {
       console.error('[SERVICE B2B]: SHOPIFY_API_SECRET não encontrado no .env.');
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

  async generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    let exists = true;
    
    while (exists) {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      const found = await Orcamento.findOne({ where: { short_code: code } });
      if (!found) exists = false;
    }
    
    return code;
  }

  async getOrcamentoByShortCode(code) {
    return await Orcamento.findOne({ where: { short_code: code } });
  }
}

module.exports = new OrcamentoService();
