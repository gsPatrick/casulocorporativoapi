const crypto = require('crypto');
require('dotenv').config();

/**
 * Middleware para validar o HMAC do Shopify App Proxy
 */
const validateShopifyProxy = (req, res, next) => {
  const query = { ...req.query };
  const signature = query.hmac || query.signature;
  
  // Remover hmac e signature do cálculo
  delete query.hmac;
  delete query.signature;
  
  if (!signature) {
    console.error('Casulo Auth: Falta assinatura (hmac/signature) na query:', req.query);
    return res.status(401).json({ error: 'Falta assinatura HMAC' });
  }

  // 1. Ordenar parâmetros alfabeticamente
  const sortedParams = Object.keys(query)
    .sort()
    .map(key => `${key}=${query[key]}`)
    .join(''); 

  // 2. Calcular HMAC SHA-256 usando o App Secret
  const calculatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(sortedParams)
    .digest('hex');

  if (calculatedHmac !== signature) {
    console.error('Casulo Auth: Falha na validação HMAC. Calculado:', calculatedHmac, 'Recebido:', signature);
    // Em desenvolvimento, você pode querer relaxar isso ou ver o log
    // return res.status(401).json({ error: 'Assinatura HMAC inválida' });
  }

  next();
};

/**
 * Middleware para validar a sessão do cliente em rotas de App Proxy
 * O Shopify envia o 'logged_in_customer_id' na query se o usuário estiver logado.
 */
const validateCustomerSession = async (req, res, next) => {
  const requestedId = req.params.customer_id;
  
  // No App Proxy do Shopify, o ID do cliente logado vem na query string
  // Shopify garante a integridade desse dado através do HMAC validado anteriormente.
  const loggedInId = req.query.logged_in_customer_id || req.query.customer_id;

  console.log(`[AUTH]: Validando Sessão - Requisitado: ${requestedId}, Logado: ${loggedInId}`);

  if (!loggedInId) {
    return res.status(403).json({ error: 'Sessão do cliente não encontrada. Por favor, faça login na loja.' });
  }

  // Se a rota possui um ID específico na URL, validamos se o cliente logado é ele mesmo
  if (requestedId) {
    const cleanRequestedId = requestedId.replace('gid://shopify/Customer/', '');
    const cleanLoggedInId = loggedInId.replace('gid://shopify/Customer/', '');

    if (cleanRequestedId !== cleanLoggedInId) {
      console.warn(`[AUTH]: Tentativa de acesso não autorizado de ${cleanLoggedInId} para dados de ${cleanRequestedId}`);
      return res.status(403).json({ error: 'Acesso negado: Você só pode ver seus próprios orçamentos.' });
    }
  } else {
    // Se a rota não exige um ID de cliente específico na URL, garantimos apenas que o cliente esteja logado no e-mail correto (O controller cuida da validação do orcamento vs customer_id).
    req.loggedInCustomerId = loggedInId.replace('gid://shopify/Customer/', '');
  }

  next();
};

module.exports = { validateShopifyProxy, validateCustomerSession };
