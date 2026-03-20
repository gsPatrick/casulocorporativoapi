const pdfService = require('./src/features/Orcamento/pdf.service');
const fs = require('fs');
const path = require('path');

async function test() {
  const mockOrcamento = {
    id: 'test-12345678',
    createdAt: new Date(),
    shopify_customer_id: '67890',
    lead_json: {
      nome: 'Alvo Dumbledore',
      email: 'alvo@hogwarts.edu.br',
      whatsapp: '(11) 99999-8888'
    },
    line_items_json: [
      {
        title: 'Cadeira C4 29001',
        quantity: 2,
        price: '4830.00',
        technical_specification: 'Apoio de Cabeça C4 Apoio: Sim\nAssento Ergonômico E1 Revestimento: Poliéster\nRevestimento Poliéster Cor: Vermelho Real 192\nBase Giratória Modelo: Nylon preta\nRodízios Modelo: Nylon 65mm',
        custom_image: 'https://cdn.shopify.com/s/files/1/0663/2223/5638/files/cadeira-teste.png?v=1710892000'
      }
    ],
    total_price: '9660.00'
  };

  console.log('Iniciando teste de PDF...');
  
  // Mock response object
  const res = {
    end: (buffer) => {
      const outputPath = path.join(__dirname, 'test-proposta-out.pdf');
      fs.writeFileSync(outputPath, buffer);
      console.log(`PDF gerado com sucesso em: ${outputPath}`);
    }
  };

  try {
    await pdfService.generateOrcamentoPDF(mockOrcamento, res);
  } catch (err) {
    console.error('Erro no teste:', err.message);
  }
}

test();
