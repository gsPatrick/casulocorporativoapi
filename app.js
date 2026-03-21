const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const sequelize = require('./src/config/database');
const routes = require('./src/routes');

// Importar modelos para garantir que o Sequelize os mapeie antes do .sync()
require('./src/models/Orcamento');
require('./src/models/SyncQueue');

const app = express();
const PORT = process.env.PORT || 3000;

// Log Global de Depuração: Registrar TUDO que chega ao servidor
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] [HTTP]: ${req.method} ${req.url}`);
  next();
});

// Middlewares
const path = require('path');

app.use(cors({
  origin: '*', // Em produção, idealmente restringir ao domínio da loja
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Shopify-Hmac-Sha256', 'X-Shopify-Shop-Domain', 'X-Shopify-API-Key']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Rota de Health Check (Direta)
app.get('/ping', (req, res) => res.send('pong'));

// Rota estática de Debug para imagens temporárias (Acesso Direto)
app.use('/debug-images', express.static(path.join(__dirname, 'src/temp/images')));

// Rotas
app.use('/api', routes);

// Sincronizar Banco e Iniciar Servidor
const startServer = async () => {
  // Limpeza de emergência/teste: Remove imagens temporárias no startup
  try {
    const imagesDir = path.join(__dirname, 'src/temp/images');
    if (fs.existsSync(imagesDir)) {
      const files = fs.readdirSync(imagesDir);
      files.forEach(file => { if (file !== '.gitkeep') fs.unlinkSync(path.join(imagesDir, file)); });
      console.log(`🧹 Limpeza completa: ${files.length} imagens removidas do cache.`);
    }
  } catch (e) {
    console.warn('⚠️ Falha na limpeza de startup:', e.message);
  }

  try {
    await sequelize.authenticate();
    console.log('✅ Conexão com Postgres estabelecida com sucesso.');
    
    // Sync models (Usa { force: true } por solicitação do usuário para testes do zero)
    await sequelize.sync({ force: true });
    console.log('✅ Banco de dados RESETADO e sincronizado (MODO: TESTE DO ZERO).');

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Erro no startup do servidor:', error);
    // Inicia o servidor mesmo se o DB falhar para não travar o ambiente
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT} (Modo de Recuperação - Sem DB)`);
    });
  }
};

startServer();
