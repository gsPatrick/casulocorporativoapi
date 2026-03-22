const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');
const nodemailer = require('nodemailer');

class OrcamentoService {
  async createOrcamento(data) {
    const startService = Date.now();
    const parsedItems = this.parseItems(data.items);
    const totalPrice = this.calculateTotalPrice(parsedItems);

    // 1. Persistir no Postgres
    
    // Bypass Shopify 504 Timeout: Extraímos os Base64 pesados para processar em segundo plano
    const orcamentoId = require('crypto').randomUUID();
    
    // 1.5 Sincronização com CartItem (v3.7.0): Se o item não tem imagem mas foi sincronizado antes
    const CartItem = require('../../models/CartItem');
    const enrichedItems = await Promise.all(parsedItems.map(async (item) => {
      if (!item.custom_image && data.customer_id) {
        const synced = await CartItem.findOne({
          where: { shopify_customer_id: data.customer_id.toString(), variant_id: item.variant_id?.toString() }
        });
        if (synced && (synced.last_snapshot || synced.image_url)) {
          console.log(`[SERVICE]: Recuperando imagem sincronizada para variant ${item.variant_id}`);
          return { ...item, custom_image: synced.last_snapshot || synced.image_url };
        }
      }
      return item;
    }));

    const { items: finalItems, base64Map } = this.extractBase64Images(enrichedItems, orcamentoId);
    console.log(`[${new Date().toISOString()}] [SERVICE]: Extração de Base64 concluída em ${Date.now() - startService}ms`);

    const dbStart = Date.now();
    const orcamento = await Orcamento.create({
      id: orcamentoId,
      shopify_customer_id: data.customer_id ? data.customer_id.toString() : null,
      lead_json: data.lead || null,
      line_items_json: finalItems,
      total_price: totalPrice,
      status: 'pendente'
    });
    console.log(`[${new Date().toISOString()}] [SERVICE]: Escrita no Postgres concluída em ${Date.now() - dbStart}ms (Total: ${Date.now() - startService}ms)`);

    // 2. Processar tarefas secundárias em Segundo Plano (Background)
    this.processPostCreationTasks(orcamento, base64Map).catch(err => {
      console.error(`[${new Date().toISOString()}] [SERVICE ERROR]:`, err.message);
    });

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
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.mailtrap.io',
      port: process.env.EMAIL_PORT || 2525,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const isLead = !orcamento.shopify_customer_id && orcamento.lead_json;
    const clientInfo = isLead 
      ? `Lead: ${orcamento.lead_json.nome} (${orcamento.lead_json.whatsapp})` 
      : `Cliente Shopify ID: ${orcamento.shopify_customer_id}`;

    const pdfLink = `${process.env.APP_URL || 'https://sua-api.com'}/api/orcamento/${orcamento.id}/pdf`;

    const mailOptions = {
      from: '"Casulo B2B" <no-reply@casulo.com>',
      to: 'comercial@casulo.com',
      subject: `Novo Orçamento: ${isLead ? orcamento.lead_json.nome : 'Cliente #' + orcamento.shopify_customer_id}`,
      html: `
        <h2>Nova Solicitação de Orçamento</h2>
        <p><strong>ID:</strong> ${orcamento.id}</p>
        <p><strong>Origem:</strong> ${clientInfo}</p>
        <p><strong>E-mail:</strong> ${isLead ? orcamento.lead_json.email : 'N/A (Logado)'}</p>
        <p><strong>Valor Estimado:</strong> R$ ${parseFloat(orcamento.total_price).toFixed(2)}</p>
        <hr />
        <p><strong>Itens:</strong></p>
        ${orcamento.line_items_json.map(item => `
          <div style="margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
            <p><strong>Produto:</strong> ${item.product_id}</p>
            <p><strong>Especificação:</strong> ${item.technical_specification || 'N/A'}</p>
            ${item.custom_image ? `<p><img src="${item.custom_image}" width="200" style="border: 1px solid #ddd;" /></p>` : ''}
            ${item.configuration_url ? `<p><a href="${item.configuration_url}" target="_blank" style="color: #814620; font-weight: bold;">[Ver Configuração 3D]</a></p>` : ''}
          </div>
        `).join('')}
        <hr />
        <p>Baixar proposta completa em PDF: <a href="${pdfLink}">Link da Proposta</a></p>
      `
    };

    return await transporter.sendMail(mailOptions);
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
    const isLead = !orcamento.shopify_customer_id && orcamento.lead_json;
    const clientName = isLead ? orcamento.lead_json.nome : `Customer_${orcamento.shopify_customer_id}`;

    const variables = {
      metaobject: {
        type: 'orcamento',
        fields: [
          { key: 'customer_id', value: orcamento.shopify_customer_id || 'guest' },
          { key: 'customer_name', value: clientName },
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
    const finalItems = items.map((item, index) => {
      if (item.custom_image && (item.custom_image.startsWith('data:image') || item.custom_image.startsWith('http'))) {
        base64Map[index] = item.custom_image;
        return {
          ...item,
          custom_image: `/apps/orcamento/images/${orcamentoId}/${index}`
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
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        console.log(`[ORCAMENTO SERVICE]: Imagem salva em disco: ${fileName} (${buffer.length} bytes)`);
        console.log(`[LINK DA IMAGEM]: ${appUrl}/api/orcamento/images/${orcamentoId}/${index}`);
      } catch (err) {
        console.error(`[ORCAMENTO SERVICE]: Falha ao processar imagem ${index} (${data.substring(0, 30)}...):`, err.message);
      }
    });

    await Promise.all(promises);
  }
}

module.exports = new OrcamentoService();
