const axios = require('axios');

class BlingService {
  constructor() {
    this.baseUrl = 'https://api.bling.com.br/Api/v3';
    this.clientId = process.env.BLING_CLIENT_ID;
    this.clientSecret = process.env.BLING_CLIENT_SECRET;
    
    // Ativa o Modo Mock se não houver credenciais básicas
    this.isMock = !this.clientId || !this.clientSecret;
    
    if (this.isMock) {
      console.log('⚠️ [BLING SERVICE]: Credenciais OAuth2 não configuradas. Iniciando em MODO MOCK.');
    }
  }

  /**
   * Obtém headers autenticados dinamicamente (do .env ou cache)
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${process.env.BLING_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Tenta renovar o Access Token usando o Refresh Token
   */
  async refreshAuthToken() {
    if (this.isMock) return;

    const refreshToken = process.env.BLING_REFRESH_TOKEN;
    if (!refreshToken) {
      console.error('[BLING SERVICE]: Refresh Token ausente. Autorização manual necessária.');
      return;
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    try {
      console.log('[BLING SERVICE]: Tentando renovar Access Token...');
      const response = await axios.post(`${this.baseUrl}/oauth/token`, 
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authHeader}`
          }
        }
      );

      const { access_token, refresh_token } = response.data;
      
      // ATUALIZAÇÃO RECOMENDADA EM AMBIENTE PROD: Salvar em DB. 
      // Por enquanto, atualizamos em memória/log para o usuário.
      process.env.BLING_ACCESS_TOKEN = access_token;
      process.env.BLING_REFRESH_TOKEN = refresh_token;

      console.log('[BLING SERVICE]: Token renovado com sucesso!');
      return access_token;
    } catch (error) {
      console.error('[BLING SERVICE ERROR]: Falha ao renovar token.', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Wrapper para chamadas API com Retentativa em caso de 401
   */
  async apiCall(method, url, data = null, params = {}) {
    if (this.isMock) return null;

    try {
      const config = {
        method,
        url: `${this.baseUrl}${url}`,
        headers: this.getHeaders(),
        params,
        data
      };
      const response = await axios(config);
      return response.data.data;
    } catch (error) {
      if (error.response?.status === 401) {
        console.warn('[BLING SERVICE]: Token expirado detectado. Renovando...');
        await this.refreshAuthToken();
        // Repete a chamada uma vez com o novo token
        const newConfig = {
          method,
          url: `${this.baseUrl}${url}`,
          headers: this.getHeaders(),
          params,
          data
        };
        const secondTry = await axios(newConfig);
        return secondTry.data.data;
      }
      throw error;
    }
  }

  async getProdutoByCodigo(codigo) {
    if (this.isMock) return null;
    return this.apiCall('GET', '/produtos', null, { codigo });
  }

  async createProduto(data) {
    if (this.isMock) return { id: Date.now() };
    const payload = {
      nome: data.nome,
      codigo: data.codigo,
      tipo: 'P',
      situacao: 'A',
      formato: 'S',
      descricaoCurta: data.descricao,
      midia: {
        imagens: {
          externas: [ { link: data.imageUrl } ]
        }
      }
    };
    return this.apiCall('POST', '/produtos', payload);
  }

  async createPedidoVenda(orcamento, blingProdutos) {
    if (this.isMock) return { id: `MOCK-${Date.now()}` };

    const isLead = !orcamento.shopify_customer_id && orcamento.lead_json;
    const payload = {
      contato: {
        nome: isLead ? orcamento.lead_json.nome : `Cliente Shopify ${orcamento.shopify_customer_id}`,
        tipoPessoa: 'F',
        email: isLead ? orcamento.lead_json.email : null,
        telefone: isLead ? orcamento.lead_json.whatsapp : null
      },
      itens: blingProdutos.map(p => ({
        codigo: p.codigo,
        quantidade: p.quantidade || 1,
        valor: 0.00,
        descricao: p.nome
      })),
      observacoes: `Orçamento B2B Shopify #${orcamento.id}\nLead originado do sistema de cotação.`
    };
    return this.apiCall('POST', '/pedidos/vendas', payload);
  }
}

module.exports = new BlingService();
