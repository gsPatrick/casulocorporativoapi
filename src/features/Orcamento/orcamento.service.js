const Orcamento = require('../../models/Orcamento');
const shopify = require('../../config/shopify');
const nodemailer = require('nodemailer');

class OrcamentoService {
  async createOrcamento(data) {
    const parsedItems = this.parseItems(data.items);
    const totalPrice = this.calculateTotalPrice(parsedItems);

    // 1. Persistir no Postgres
    const orcamento = await Orcamento.create({
      shopify_customer_id: data.customer_id,
      line_items_json: parsedItems,
      total_price: totalPrice,
      status: 'pendente'
    });

    // 2. Sincronizar com Shopify Metaobjects
    try {
      const metaobjectRef = await this.syncWithShopifyMetaobject(orcamento);
      await orcamento.update({ pdf_url: metaobjectRef });
    } catch (error) {
      console.error('Falha na sincronização inicial com Metaobjects:', error.message);
    }

    // 3. Notificação Comercial (Stage 3)
    try {
      await this.sendCommercialNotification(orcamento);
    } catch (error) {
      console.error('Falha ao enviar e-mail de notificação:', error.message);
    }

    return orcamento;
  }

  async sendCommercialNotification(orcamento) {
    // Configuração do transportador (Ajustar com credenciais reais no .env)
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.mailtrap.io',
      port: process.env.EMAIL_PORT || 2525,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const pdfLink = `${process.env.APP_URL || 'https://sua-api.com'}/api/orcamento/${orcamento.id}/pdf`;

    const mailOptions = {
      from: '"Casulo B2B" <no-reply@casulo.com>',
      to: 'comercial@casulo.com',
      subject: `Novo Orçamento Recebido - Cliente #${orcamento.shopify_customer_id}`,
      html: `
        <h2>Nova Solicitação de Orçamento</h2>
        <p><strong>ID do Orçamento:</strong> ${orcamento.id}</p>
        <p><strong>Cliente Shopify:</strong> ${orcamento.shopify_customer_id}</p>
        <p><strong>Valor Estimado:</strong> R$ ${parseFloat(orcamento.total_price).toFixed(2)}</p>
        <hr />
        <p><strong>Configuração:</strong></p>
        <pre>${JSON.stringify(orcamento.line_items_json, null, 2)}</pre>
        <hr />
        <p>Você pode baixar a proposta completa aqui: <a href="${pdfLink}">Ver PDF da Proposta</a></p>
      `
    };

    return await transporter.sendMail(mailOptions);
  }

  parseItems(items) {
    if (!Array.isArray(items)) return [];

    return items.map(item => {
      if (item.type === 'configurable') {
        if (!item.customizer_state || Object.keys(item.customizer_state).length === 0) {
          throw new Error(`Item configurável (${item.product_id}) sem estado do customizador.`);
        }

        return {
          type: 'configurable',
          product_id: item.product_id,
          bundle_variants: item.bundle_variants || [],
          customizer_state: item.customizer_state,
          configuration_url: item.configuration_url || '',
          quantity: item.quantity || 1
        };
      }

      return {
        type: 'standard',
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity || 1,
        title: item.title || 'Produto Padrão'
      };
    });
  }

  calculateTotalPrice(items) {
    let total = 0;
    items.forEach(item => {
      const basePrice = 100.00; 
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
    const query = `
      mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      metaobject: {
        type: 'orcamento',
        fields: [
          { key: 'customer_id', value: orcamento.shopify_customer_id },
          { key: 'total_price', value: orcamento.total_price.toString() },
          { key: 'configuration_summary', value: JSON.stringify(orcamento.line_items_json) }
        ]
      }
    };

    console.log('Sincronizando com Shopify Metaobjects...', orcamento.id);
    // Simulação de retorno
    return `gid://shopify/Metaobject/mock-${orcamento.id.substring(0,8)}`;
  }
}

module.exports = new OrcamentoService();
