const pdfService = require('./src/features/Orcamento/pdf.service');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('Lendo e processando imagem de teste...');
  const sharp = require('sharp');
  const imageBuffer = fs.readFileSync(path.join(__dirname, '0 (1).png'));
  
  // Aplica o crop na imagem de teste para o PDF de saída
  const croppedImageBuffer = await sharp(imageBuffer).trim().toBuffer();
  const base64Image = croppedImageBuffer.toString('base64'); // RAW base64 for the template

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
        quantity: 12,
        unit_price_formatted: "R$ 1.208,71",
        total_price_formatted: "R$ 14.504,52",
        technical_specification: "Dimensões: 610 x 540 x 760 mm\nCódigo: CACAD2505\nOrigem: Nacional\nTipo de Revestimento: TECIDO B (Lona Reforçada)\nCor do Revestimento: B190 - HOPSCOTCH B&W (Padrão Corporativo)\nTipo de Acabamento da Base: PINTURA EPÓXI PADRÃO (Resistência Industrial)\nCor da Base: PRETO FOSCO (PRETO S.BRL)\nEncosto: Espuma Injetada com Memória\nBraços: Regulagem de Altura 3D",
        especificacao_generica: "Este produto atende integralmente todos os requisitos de durabilidade e ergonomia exigidos para ambientes corporativos de alto tráfego. Possui certificação de conformidade com as normas NR-17 de ergonomia e segurança no trabalho, garantindo o conforto do usuário por longos períodos de utilização. A garantia estrutural é estendida para 5 anos devido ao tratamento anticorrosivo da base metálica.",
        category: "COPA",
        legend_id: "M1",
        custom_image_base64: base64Image
      },
      {
        title: "POLTRONA NOVOLI",
        quantity: 5,
        unit_price_formatted: "R$ 2.656,79",
        total_price_formatted: "R$ 13.283,95",
        technical_specification: "Dimensões: 750 x 750 x 750 mm\nCódigo: NOPOL2213\nOrigem: Nacional\nDesign: Assento, encosto e braços estofados. Estrutura metálica com acabamento em pintura epóxi. Revestimentos do assento / encosto/ braços e cores da estrutura metálica de acordo com as cores padronizadas (vide catálogo de cores)",
        especificacao_generica: "A poltrona Novoli é um ícone de design que une sofisticação e conforto. Ideal para áreas de recepção e lounges executivos. A estrutura é reforçada para suportar até 150kg sem sofrer deformações. Os tecidos são tratados com tecnologia anti-mancha e proteção UV, mantendo a vivacidade das cores por muito mais tempo mesmo em ambientes com incidência solar direta.",
        category: "COPA",
        legend_id: "M2",
        custom_image_base64: base64Image
      }
    ],
    customer_tags: ['Aprovado'],
    total_price: '15767.42',
    termos_contrato: "• O prazo de entrega estimado é de 30 a 45 dias úteis.\n• Pagamento: 50% de entrada e o restante em 3x no boleto.\n• Montagem inclusa para Grande Florianópolis."
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
