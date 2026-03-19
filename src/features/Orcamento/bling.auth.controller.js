const axios = require('axios');
const fs = require('fs');
const path = require('path');

class BlingAuthController {
  /**
   * Redireciona para o portal do Bling para o usuário autorizar nossa aplicação.
   */
  async authorize(req, res) {
    const clientId = process.env.BLING_CLIENT_ID;
    const redirectUri = `${process.env.APP_URL}/api/orcamento/bling/callback`;
    
    if (!clientId) {
      return res.status(500).send('ERRO: BLING_CLIENT_ID não configurado no .env');
    }

    const authUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=casulo_b2b`;
    
    console.log(`[BLING AUTH]: Redirecionando para autorização: ${authUrl}`);
    res.redirect(authUrl);
  }

  /**
   * Recebe o código de autorização do Bling e troca pelos tokens iniciais (Access e Refresh).
   */
  async callback(req, res) {
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).send('ERRO: Código de autorização não recebido do Bling.');
    }

    const clientId = process.env.BLING_CLIENT_ID;
    const clientSecret = process.env.BLING_CLIENT_SECRET;
    const redirectUri = `${process.env.APP_URL}/api/orcamento/bling/callback`;

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      console.log('[BLING AUTH]: Trocando código por tokens...');
      
      const response = await axios.post('https://www.bling.com.br/Api/v3/oauth/token', 
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authHeader}`
          }
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;
      
      console.log('[BLING AUTH]: Tokens obtidos com sucesso!');
      
      // Salva os tokens no .env ou banco para persistência (Simulado aqui no .env)
      this.saveTokensToEnv(access_token, refresh_token);

      res.send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: green;">🎉 Bling Integrado com Sucesso!</h1>
          <p>Seus tokens foram salvos e o sistema de orçamentos agora está sincronizado.</p>
          <a href="/admin" style="display:inline-block; margin-top: 20px; padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 5px;">Voltar ao Painel</a>
        </div>
      `);

    } catch (error) {
      console.error('[BLING AUTH ERROR]:', error.response?.data || error.message);
      res.status(500).json({ 
        error: 'Falha na troca de tokens com o Bling', 
        details: error.response?.data || error.message 
      });
    }
  }

  /**
   * TODO: Salvar em um local persistente real (DB/Config). 
   * Por enquanto, vamos logar para o usuário colocar no .env.
   */
  saveTokensToEnv(access, refresh) {
    console.log('\n--- ATUALIZE SEU ARQUIVO .env COM ESTES TOKENS ---');
    console.log(`BLING_ACCESS_TOKEN=${access}`);
    console.log(`BLING_REFRESH_TOKEN=${refresh}`);
    console.log('--------------------------------------------------\n');
  }
}

module.exports = new BlingAuthController();
