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

// Middlewares
app.use(cors({
  origin: '*', // Em produção, idealmente restringir ao domínio da loja
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Shopify-Hmac-Sha256', 'X-Shopify-Shop-Domain', 'X-Shopify-API-Key']
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Rotas
app.use('/api', routes);

// Sincronizar Banco e Iniciar Servidor
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexão com Postgres estabelecida com sucesso.');
    
    // Sync models (Usa { alter: true } para proteger os dados existentes)
    await sequelize.sync({ alter: true });
    console.log('✅ Modelos sincronizados com o banco de dados.');

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
