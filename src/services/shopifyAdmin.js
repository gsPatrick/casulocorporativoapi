const axios = require('axios');
require('dotenv').config();

/**
 * Serviço para chamadas à Admin API da Shopify via GraphQL
 */
const shopifyAdmin = {
  /**
   * Executa uma query ou mutation GraphQL
   */
  async query(query, variables = {}) {
    const shop = process.env.SHOPIFY_HOST_NAME;
    // Tenta usar o token específico do Admin, caso contrário usa o secret (para apps privados legados)
    const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_API_SECRET; 
    
    const url = `https://${shop}/admin/api/2024-04/graphql.json`;
    
    try {
      const response = await axios({
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        data: JSON.stringify({ query, variables }),
      });
      
      if (response.data.errors) {
        console.error('[SHOPIFY GRAPHQL ERRORS]:', JSON.stringify(response.data.errors, null, 2));
      }
      
      return response.data;
    } catch (error) {
      console.error('[SHOPIFY ADMIN API HTTP ERROR]:', error.response?.data || error.message);
      throw error;
    }
  },

  /**
   * Cria um novo cliente na Shopify com a tag 'acesso-restrito'
   */
  async createCustomer(customerData) {
    const mutation = `
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
            firstName
            lastName
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Garantir que o input tenha as tags necessárias
    const tags = Array.isArray(customerData.tags) ? customerData.tags : (customerData.tags ? customerData.tags.split(',') : []);
    if (!tags.includes('acesso-restrito')) {
      tags.push('acesso-restrito');
    }

    const input = {
      firstName: customerData.firstName,
      lastName: customerData.lastName,
      email: customerData.email,
      phone: customerData.phone,
      tags: tags,
      emailMarketingConsent: {
        marketingState: 'SUBSCRIBED',
        marketingOptInLevel: 'SINGLE_OPT_IN'
      }
    };

    const result = await this.query(mutation, { input });
    
    if (!result || !result.data || !result.data.customerCreate) {
      throw new Error('Resposta inválida da API da Shopify');
    }

    return result.data.customerCreate;
  }
};

module.exports = shopifyAdmin;
