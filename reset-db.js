const sequelize = require('./src/config/database');
const fs = require('fs');
const path = require('path');

// Importar modelos
require('./src/models/Orcamento');
require('./src/models/SyncQueue');

async function resetDb() {
  try {
    console.log('--- RESET DO BANCO DE DADOS ---');
    
    // 1. Limpar Banco de Dados (Drop & Create)
    console.log('Limpando tabelas (force: true)...');
    await sequelize.sync({ force: true });
    console.log('✅ Tabelas recriadas e limpas!');

    // 2. Limpar Imagens Temporárias
    const imagesDir = path.join(__dirname, 'src/temp/images');
    if (fs.existsSync(imagesDir)) {
      console.log('Limpando diretório de imagens temporárias...');
      const files = fs.readdirSync(imagesDir);
      for (const file of files) {
        if (file !== '.gitkeep') {
          fs.unlinkSync(path.join(imagesDir, file));
        }
      }
      console.log(`✅ ${files.length} arquivos removidos!`);
    }

    console.log('--- TUDO PRONTO PARA TESTAR DO ZERO! 🚀 ---');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro no reset do banco:', error);
    process.exit(1);
  }
}

resetDb();
