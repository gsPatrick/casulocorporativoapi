const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');
const nodemailer = require('nodemailer');

class OrcamentoService {
  async createOrcamento(data) {
    const parsedItems = this.parseItems(data.items);
    const totalPrice = this.calculateTotalPrice(parsedItems);

    // 1. Persistir no Postgres
    console.log(`[ORCAMENTO SERVICE]: Criando registro para cliente: ${data.customer_id || 'GUEST'}`);
    
    // Bypass Shopify Proxy Limit: Salvar imagens Base64 no disco e usar URLs
    const orcamentoId = require('crypto').randomUUID(); // Gerar ID antecipado para o nome do arquivo
    const finalItems = await this.saveBase64ImagesToDisk(parsedItems, orcamentoId);

    const orcamento = await Orcamento.create({
      id: orcamentoId,
      shopify_customer_id: data.customer_id ? data.customer_id.toString() : null,
      lead_json: data.lead || null,
      line_items_json: finalItems,
      total_price: totalPrice,
      status: 'pendente'
    });

    // 2. Processar tarefas secundárias em Segundo Plano (Background)
    // Não usamos 'await' aqui para retornar a resposta rápido ao Shopify
    this.processPostCreationTasks(orcamento).catch(err => {
      console.error('Erro em tarefas pós-criação:', err.message);
    });

    return orcamento;
  }

  /**
   * Executa tarefas que não precisam bloquear a resposta HTTP
   */
  async processPostCreationTasks(orcamento) {
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
  async saveBase64ImagesToDisk(items, orcamentoId) {
    const fs = require('fs');
    const path = require('path');
    const imagesDir = path.join(__dirname, '../../temp/images');
    
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    return Promise.all(items.map(async (item, index) => {
      if (item.custom_image && item.custom_image.startsWith('data:image')) {
        try {
          const base64Content = item.custom_image.split(',')[1];
          if (!base64Content) return item;

          const buffer = Buffer.from(base64Content, 'base64');
          // Forçar PNG para consistência ou detectar via MIME
          const filename = `snapshot-${orcamentoId}-${index}.png`;
          const filePath = path.join(imagesDir, filename);
          
          fs.writeFileSync(filePath, buffer);
          
          // Limpando o APP_URL para evitar barras duplas
          const baseUrl = (process.env.APP_URL || '').replace(/\/$/, '');
          const fullUrl = `${baseUrl}/apps/orcamento/api/orcamento/images/${orcamentoId}/${index}`;
          console.log(`[ORCAMENTO SERVICE]: Snapshot salvo em disco: ${filename} (${buffer.length} bytes)`);
          console.log(`[ORCAMENTO SERVICE]: URL Pública (Dentro do Shopify): ${fullUrl}`);
          
          // Rota de Debug (Estática - Acesso Direto para Verificação)
          const debugUrl = `${baseUrl}/debug-images/${filename}`;
          console.log(`[ORCAMENTO SERVICE]: 🕵️ URL de REVISÃO (Direta): ${debugUrl}`);
          
          // A URL gerada será consumida pelo App Proxy do Shopify
          return {
            ...item,
            custom_image: `/apps/orcamento/api/orcamento/images/${orcamentoId}/${index}`
          };
        } catch (err) {
          console.error(`[ORCAMENTO SERVICE]: Falha ao salvar Base64 no disco`, err.message);
        }
      }
      return item;
    }));
  }
}

module.exports = new OrcamentoService();
