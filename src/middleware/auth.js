const crypto = require('crypto');
require('dotenv').config();

/**
 * Middleware para validar o HMAC do Shopify App Proxy
 */
const validateShopifyProxy = (req, res, next) => {
  const { hmac, ...query } = req.query;
  
  if (!hmac) {
    return res.status(401).json({ error: 'Falta assinatura HMAC' });
  }

  // 1. Ordenar parâmetros alfabeticamente
  const sortedParams = Object.keys(query)
    .sort()
    .map(key => `${key}=${query[key]}`)
    .join(''); // Algumas versões usam join('') outras join(',') mas o padrão Proxy é join('')

  // 2. Calcular HMAC SHA-256 usando o App Secret
  const calculatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(sortedParams)
    .digest('hex');

  if (calculatedHmac !== hmac) {
    console.error('Falha na validação HMAC');
    return res.status(401).json({ error: 'Assinatura HMAC inválida' });
  }

  next();
};

/**
 * Middleware para validar a sessão do cliente via Storefront API
 * (Obrigatório para rotas sensíveis como 'Meus Orçamentos')
 */
const validateCustomerSession = async (req, res, next) => {
  const customerIdFromReq = req.body.customer_id || req.params.customer_id || req.query.customer_id;
  const storefrontAccessToken = req.headers['x-shopify-customer-access-token'];

  if (!storefrontAccessToken) {
    return res.status(403).json({ error: 'Sessão do cliente não fornecida' });
  }

  try {
    // Validar token na Storefront API
    const response = await fetch(`https://${process.env.SHOPIFY_HOST_NAME}/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || ''
      },
      body: JSON.stringify({
        query: `
          query {
            customer(customerAccessToken: "${storefrontAccessToken}") {
              id
            }
          }
        `
      })
    });

    const result = await response.json();
    const sessionCustomerId = result.data?.customer?.id;

    if (!sessionCustomerId) {
      return res.status(403).json({ error: 'Sessão inválida ou expirada' });
    }

    // Extrair apenas o número do ID (Shopify retorna gid://shopify/Customer/12345)
    const numericSessionId = sessionCustomerId.split('/').pop();
    const numericReqId = customerIdFromReq.replace('gid://shopify/Customer/', '');

    if (numericSessionId !== numericReqId) {
      console.warn(`Tentativa de acesso não autorizado: Req ID ${numericReqId} vs Session ID ${numericSessionId}`);
      return res.status(403).json({ error: 'Acesso negado: ID do cliente não corresponde à sessão' });
    }

    next();
  } catch (error) {
    console.error('Erro na validação da Storefront API:', error.message);
    res.status(500).json({ error: 'Erro ao validar sessão' });
  }
};

module.exports = { validateShopifyProxy, validateCustomerSession };
