const pdfService = require('./src/features/Orcamento/pdf.service');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('Lendo e processando imagem de teste...');
  const sharp = require('sharp');
  const imageBuffer = fs.readFileSync(path.join(__dirname, '0 (1).png'));
  
  // Aplica o crop na imagem de teste para o PDF de saída
  const croppedImageBuffer = await sharp(imageBuffer).trim().toBuffer();
  const base64Image = `data:image/png;base64,${croppedImageBuffer.toString('base64')}`;

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
        title: "CADEIRA CASALIA EM METAL COM BRAÇOS",
        quantity: 2,
        unit_price_formatted: "R$ 1208,71",
        total_price_formatted: "R$ 2417,42",
        technical_specification: "Assento e encosto estofados\nEstrutura metálica com acabamento em pintura epóxi\nTipo de Revestimento: TECIDO B\nCor: HOPSCOTCH B&W",
        especificacao_generica: "Produto certificado NR-17 conforme normas de ergonomia vigentes.",
        category: "COPA",
        legend_id: "M1",
        custom_image_base64: base64Image
      },
      {
        title: "POLTRONA NOVOLI",
        quantity: 1,
        unit_price_formatted: "R$ 2656,79",
        total_price_formatted: "R$ 2656,79",
        technical_specification: "Estrutura metálica com acabamento em pintura epóxi\nTipo de Revestimento: TECIDO B\nCor: BRANCO MICROTEXTURA FOSCO",
        especificacao_generica: "Garantia de 5 anos contra defeitos de fabricação na estrutura.",
        category: "COPA",
        legend_id: "M2",
        custom_image_base64: base64Image
      },
      {
        title: "MESA DE REUNIÃO NEO",
        quantity: 1,
        unit_price_formatted: "R$ 4500,00",
        total_price_formatted: "R$ 4500,00",
        technical_specification: "Tampo em MDF 25mm\nEstrutura em aço com calhas para fiação\nAcabamento: Carvalho Natural",
        especificacao_generica: "Possui calha articulada central para tomadas e dados.",
        category: "SALA REUNIÃO",
        legend_id: "M3",
        custom_image_base64: base64Image
      },
      {
        title: "CADEIRA C4 ERGONÔMICA",
        quantity: 4,
        unit_price_formatted: "R$ 1850,00",
        total_price_formatted: "R$ 7400,00",
        technical_specification: "Mecanismo syncron\nBraços 3D reguláveis\nBase em nylon reforçado",
        especificacao_generica: "Certificação ABNT NBR 13962.",
        category: "SALA REUNIÃO",
        legend_id: "M4",
        custom_image_base64: base64Image
      }
    ],
    customer_tags: ['Aprovado'],
    total_price: '15767.42'
  };

  console.log('Iniciando teste de PDF...');
  
  // Mock response object
  const res = {
    status: (code) => {
      console.log(`[MOCK RES]: Status ${code}`);
      return res;
    },
    send: (msg) => {
      console.log(`[MOCK RES]: Send "${msg}"`);
      return res;
    },
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
