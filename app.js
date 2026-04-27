const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const sequelize = require('./src/config/database');
const routes = require('./src/routes');

// Importar modelos para garantir que o Sequelize os mapeie antes do .sync()
require('./src/models/Orcamento');
require('./src/models/SyncQueue');
require('./src/models/CartItem');
require('./src/models/Condicao');
require('./src/models/Setting');
require('./src/models/CustomerCodeHistory');

const app = express();
const PORT = process.env.PORT || 3000;

// Log Global de Depuração: Registrar TUDO que chega ao servidor
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] [HTTP]: ${req.method} ${req.url}`);
  next();
});

// Middlewares
const path = require('path');

// Configuração do Engine de Views EJS (v4.2.0)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src')); // Local onde os recursos estão agrupados por feature

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
app.use('/', routes); // Garante que a raiz do domínio também responda (Shopify App URL)

// Sincronizar Banco e Iniciar Servidor
const startServer = async () => {
  // Verificação de diretório de imagens (v12.33.15)
  const imagesDir = path.join(__dirname, 'src/temp/images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    console.log('📁 Diretório de imagens temporárias criado.');
  }

  try {
    await sequelize.authenticate();
    console.log('✅ Conexão com Postgres estabelecida com sucesso.');
    
    // Sync models (MODO RESET: force: true para limpar tudo no startup conforme solicitado)
    console.log('⚠️  Limpando e recriando banco de dados (MODO RESET)...');
    await sequelize.sync({ force: true });
    console.log('✅ Banco de dados resetado com sucesso.');

    // Limpar diretório de imagens temporárias no startup
    const files = fs.readdirSync(imagesDir);
    for (const file of files) {
      if (file !== '.gitkeep') fs.unlinkSync(path.join(imagesDir, file));
    }
    console.log('✅ Imagens temporárias limpas.');

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
