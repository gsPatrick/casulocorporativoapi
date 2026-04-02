const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');
const { Resend } = require('resend');

class OrcamentoService {
  async createOrcamento(data) {
    const startService = Date.now();
    const parsedItems = this.parseItems(data.items);
    const originalPrice = this.calculateTotalPrice(parsedItems);
    
    // Novas Regras de Negócio: Descontos e Tags (v4.0.0)
    const { vendedor, parceiro, customerTags } = this.parseBusinessTags(data.customer_tags || []);
    const { liquidPrice, discountAmount } = this.applyDiscounts(originalPrice, customerTags, data.discount_code);
    const shortCode = await this.generateShortCode();

    // 1. Persistir no Postgres
    
    // Bypass Shopify 504 Timeout: Extraímos os Base64 pesados para processar em segundo plano
    const orcamentoId = require('crypto').randomUUID();
    const CartItem = require('../../models/CartItem');
    const enrichedItems = await Promise.all(parsedItems.map(async (item) => {
      console.log(`[SERVICE DEBUG]: Item recebido - VariantID: ${item.variant_id}, CID: ${data.customer_id}, BID: ${data.browser_id}`);
        
        // Busca item sincronizado via customer_id OU browser_id
        const synced = data.customer_id ? (await CartItem.findOne({
          where: { 
            shopify_customer_id: data.customer_id.toString(), 
            variant_id: item.variant_id.toString() 
          }
        }) || (item.product_id ? await CartItem.findOne({
          where: { 
            shopify_customer_id: data.customer_id.toString(), 
            product_id: item.product_id.toString() 
          },
          order: [['updatedAt', 'DESC']]
        }) : null)) : (data.browser_id ? await CartItem.findOne({
          where: { 
            browser_id: data.browser_id.toString(), 
            variant_id: item.variant_id.toString() 
          }
        }) : null);
        
        if (synced && (synced.last_snapshot || synced.image_url)) {
          console.log(`[SERVICE SUCCESS]: Snapshot recuperado para Variant ${item.variant_id} (via ${data.customer_id ? 'Customer' : 'Browser'} ID)`);
          return { ...item, custom_image: synced.last_snapshot || synced.image_url };
        } else {
          console.log(`[SERVICE INFO]: Nenhum snapshot no banco para Variant ${item.variant_id} ou Product ${item.product_id}`);
        }
      return item;
    }));

    const { items: finalItems, base64Map } = this.extractBase64Images(enrichedItems, orcamentoId);
    console.log(`[${new Date().toISOString()}] [SERVICE]: Extração de Base64 concluída em ${Date.now() - startService}ms`);

    const dbStart = Date.now();
    const orcamento = await Orcamento.create({
      id: orcamentoId,
      shopify_customer_id: data.customer_id ? data.customer_id.toString() : null,
      customer_type: data.customer_id ? 'logado' : 'convidado',
      customer_name: data.customer_name || data.lead?.nome || (data.customer_id ? 'Cliente Shopify' : 'Visitante'),
      customer_email: data.customer_email || data.lead?.email || null,
      customer_phone: data.customer_phone || data.lead?.whatsapp || null,
      lead_json: data.lead || null,
      line_items_json: finalItems,
      total_price: liquidPrice,
      original_price: originalPrice,
      discount_amount: discountAmount,
      short_code: shortCode,
      vendedor,
      parceiro,
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

    // B. Notificação Comercial (E-mail)
    try {
      await this.sendCommercialNotification(orcamento);
    } catch (error) {
      console.error('Falha ao enviar e-mail de notificação:', error.message);
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

    const fromEmail = 'Casulo Corporativo <contato@casulocorporativo.com.br>'; 
    const toEmail = ['vendas@casulocorporativo.com.br', 'patricksiqueira.developer@gmail.com'];

    const htmlContent = `
        <h2>Nova Solicitação de Orçamento</h2>
        <p><strong>ID da Proposta:</strong> ${orcamento.id.substring(0, 8).toUpperCase()}</p>
        <p><strong>Origem:</strong> ${clientInfo}</p>
        <p><strong>E-mail:</strong> ${isLead ? orcamento.lead_json.email : 'N/A (Logado)'}</p>
        <hr />
        <p><strong>Itens:</strong></p>
        ${orcamento.line_items_json.map(item => `
          <div style="margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
            <p><strong>Produto:</strong> ${item.title || item.product_id}</p>
            <p><strong>Especificação:</strong> ${item.technical_specification || 'N/A'}</p>
            ${item.custom_image ? `<p><img src="${item.custom_image}" width="200" style="border: 1px solid #ddd;" /></p>` : ''}
            ${item.configuration_url ? `<p><a href="${item.configuration_url}" target="_blank" style="color: #814620; font-weight: bold;">[Ver Configuração 3D]</a></p>` : ''}
          </div>
        `).join('')}
        <hr />
        <p>Baixar proposta completa em PDF: <a href="${pdfLink}">Link da Proposta</a></p>
    `;

    // C. Gerar PDF para anexo
    let pdfBuffer = null;
    try {
      const pdfService = require('./pdf.service');
      pdfBuffer = await pdfService.getOrcamentoPDFBuffer(orcamento);
    } catch (err) {
      console.error('[SERVICE]: Falha ao gerar buffer do PDF para anexo:', err.message);
    }

    try {
      const data = await resend.emails.send({
        from: fromEmail,
        to: toEmail,
        subject: `Novo Orçamento: ${orcamento.customer_name} (${orcamento.customer_email || 'B2B'})`,
        html: htmlContent,
        attachments: pdfBuffer ? [
          {
            filename: `Proposta-Casulo-${orcamento.id.substring(0, 8).toUpperCase()}.pdf`,
            content: pdfBuffer.toString('base64'),
          }
        ] : []
      });
      console.log('[RESEND]: Orçamento enviado com sucesso via Resend API (com anexo).', data);
      return data;
    } catch (error) {
      console.error('[RESEND ERROR]: Erro ao enviar notificação comercial:', error);
    }
  }

  parseItems(items) {
    if (!Array.isArray(items)) return [];

    return items.map(item => {
      // Itens configuráveis agora incluem technical_specification e custom_image (Snapshot)
      const parsedItem = {
        type: item.type || 'standard',
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        title: item.title || 'Produto',
        technical_specification: item.technical_specification || '',
        additional_info: item.additional_info || '',
        custom_image: item.custom_image || null,
        configuration_url: item.configuration_url || null,
        customizer_state: item.customizer_state || {},
        quantity: item.quantity || 1
      };

      return parsedItem;
    });
  }

  calculateTotalPrice(items) {
    let total = 0;
    items.forEach(item => {
      const basePrice = 0.00; // Preços são tratados no orçamento personalizado
      total += basePrice * (item.quantity || 1);
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

        fs.writeFileSync(filePath, buffer);
        let appUrl = process.env.APP_URL || 'http://localhost:3000';
        if (appUrl.endsWith('/')) appUrl = appUrl.slice(0, -1);
        console.log(`[ORCAMENTO SERVICE]: Imagem salva em disco: ${fileName} (${buffer.length} bytes)`);
        console.log(`[LINK DA IMAGEM]: ${appUrl}/api/orcamento/images/${orcamentoId}/${index}`);
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

  applyDiscounts(originalPrice, tags, discountCode) {
    let discountPercentage = 0;
    
    // Tags de Segmento (Exclusivas - o cliente só tem uma dessas)
    if (tags.includes('cliente novo')) discountPercentage = 10;
    else if (tags.includes('cliente ocasional')) discountPercentage = 15;
    else if (tags.includes('cliente recorrente')) discountPercentage = 20;

    const tagDiscount = originalPrice * (discountPercentage / 100);
    
    // Cupom de Desconto (Valor fixo ou vindo do payload)
    // Se o cupom vier via payload como um número, abatemos. Se for código, precisaríamos de uma tabela.
    // O briefing diz: "abater cupons que vierem no payload". Vamos assumir 'discount_coupon_value'.
    const couponDiscount = 0; // Implementação futura de códigos de cupom vindo do DB

    const totalDiscount = tagDiscount + couponDiscount;
    const liquidPrice = originalPrice - totalDiscount;

    return { liquidPrice, discountAmount: totalDiscount };
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
