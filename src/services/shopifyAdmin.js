const axios = require('axios');
require('dotenv').config();

// Cache em memória para o token (expira em ~24h)
let cachedToken = {
  token: null,
  expiresAt: 0
};

/**
 * Serviço para chamadas à Admin API da Shopify via GraphQL
 * v2: Implementa fluxo de Client Credentials (OAuth) obrigatório desde 2026
 */
const shopifyAdmin = {
  /**
   * Obtém ou renova o Access Token dinamicamente
   */
  async getAccessToken() {
    const now = Date.now();
    
    // Se temos um token e ele ainda é válido por pelo menos 5 minutos, retornamos o cache
    if (cachedToken.token && cachedToken.expiresAt > (now + 300000)) {
      return cachedToken.token;
    }

    const shop = process.env.SHOPIFY_HOST_NAME;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    // Fallback para tokens estáticos (caso a loja ainda aceite ou seja legado)
    if (!clientId || !clientSecret) {
      if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
      throw new Error('Configurações da Shopify incompletas: SHOPIFY_CLIENT_ID ou SHOPIFY_CLIENT_SECRET ausentes.');
    }

    console.log('[SHOPIFY ADMIN]: Renovando access token...');
    
    try {
      const response = await axios({
        url: `https://${shop}/admin/oauth/access_token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret
        }).toString()
      });

      const { access_token, expires_in } = response.data;
      
      cachedToken = {
        token: access_token,
        expiresAt: now + (expires_in * 1000)
      };

      console.log('[SHOPIFY ADMIN]: Novo token obtido com sucesso.');
      return access_token;
    } catch (error) {
      console.error('[SHOPIFY TOKEN ERROR]:', error.response?.data || error.message);
      throw new Error('Não foi possível autenticar com a Shopify Admin API. Verifique o Client ID e Secret.');
    }
  },

  /**
   * Executa uma query ou mutation GraphQL
   */
  async query(query, variables = {}) {
    const shop = process.env.SHOPIFY_HOST_NAME;
    const accessToken = await this.getAccessToken();
    
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
