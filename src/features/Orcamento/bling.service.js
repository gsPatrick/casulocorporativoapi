const axios = require('axios');

class BlingService {
  constructor() {
    this.baseUrl = 'https://api.bling.com.br/Api/v3';
    this.accessToken = process.env.BLING_ACCESS_TOKEN;
    this.refreshToken = process.env.BLING_REFRESH_TOKEN;
    
    // Ativa o Modo Mock se não houver credenciais
    this.isMock = !this.accessToken || !this.refreshToken;
    
    if (this.isMock) {
      console.log('⚠️ [BLING SERVICE]: Credenciais não encontradas. Iniciando em MODO MOCK.');
    }
  }

  /**
   * Obtém headers autenticados
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Verifica se um produto existe pelo Código (SKU)
   */
  async getProdutoByCodigo(codigo) {
    if (this.isMock) {
      console.log(`[BLING MOCK]: Verificando produto SKU ${codigo}`);
      return null; // Força criação no mock para testar o fluxo completo
    }

    try {
      const response = await axios.get(`${this.baseUrl}/produtos`, {
        headers: this.getHeaders(),
        params: { codigo }
      });
      return response.data.data && response.data.data.length > 0 ? response.data.data[0] : null;
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  }

  /**
   * Cria um novo produto no Bling
   */
  async createProduto(data) {
    if (this.isMock) {
      console.log(`[BLING MOCK]: Criando produto ${data.nome} (SKU: ${data.codigo})`);
      return { id: Math.floor(Math.random() * 1000000), codigo: data.codigo };
    }

    const payload = {
      nome: data.nome,
      codigo: data.codigo,
      tipo: 'P',
      situacao: 'A',
      formato: 'S',
      descricaoCurta: data.descricao,
      midia: {
        imagens: {
          externas: [
            { link: data.imageUrl }
          ]
        }
      }
    };

    const response = await axios.post(`${this.baseUrl}/produtos`, payload, {
      headers: this.getHeaders()
    });
    return response.data.data;
  }

  /**
   * Cria um Pedido de Venda / Proposta
   */
  async createPedidoVenda(orcamento, blingProdutos) {
    if (this.isMock) {
      console.log(`[BLING MOCK]: Criando Pedido de Venda para Orçamento #${orcamento.id}`);
      return { id: `MOCK-PEDIDO-${Date.now()}`, status: 'success' };
    }

    const isLead = !orcamento.shopify_customer_id && orcamento.lead_json;
    
    const payload = {
      contato: {
        nome: isLead ? orcamento.lead_json.nome : `Cliente Shopify ${orcamento.shopify_customer_id}`,
        tipoPessoa: 'F', // Default F
        email: isLead ? orcamento.lead_json.email : null,
        telefone: isLead ? orcamento.lead_json.whatsapp : null
      },
      itens: blingProdutos.map(p => ({
        codigo: p.codigo,
        quantidade: p.quantidade || 1,
        valor: 0.00, // Preços B2B sob consulta no Bling
        descricao: p.nome
      })),
      observacoes: `Orçamento B2B via Shopify #${orcamento.id}\nLead originado do sistema de cotação.`
    };

    const response = await axios.post(`${this.baseUrl}/pedidos/vendas`, payload, {
      headers: this.getHeaders()
    });
    return response.data.data;
  }

  /**
   * TODO: Implementar renovação de token OAuth2 se necessário
   */
  async refreshAuthToken() {
    if (this.isMock) return;
    console.log('Renovando token do Bling...');
  }
}

module.exports = new BlingService();
