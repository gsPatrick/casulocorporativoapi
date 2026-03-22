const sequelize = require('./src/config/database');
require('./src/models/Orcamento');
require('./src/models/SyncQueue');
require('./src/models/CartItem');

async function syncDb() {
  try {
    console.log('Sincronizando modelos com o banco de dados...');
    await sequelize.sync({ alter: true });
    console.log('✅ Banco de dados sincronizado com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao sincronizar banco de dados:', error);
    process.exit(1);
  }
}

syncDb();
