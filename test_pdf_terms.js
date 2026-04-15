const pdfService = require('./src/features/Orcamento/pdf.service');
const fs = require('fs');
const path = require('path');

async function testPdf() {
    console.log('--- TESTE DE GERAÇÃO DE PDF COM TERMOS LONGOS ---');
    
    // Mock de orçamento com termo de contrato extenso
    const mockOrcamento = {
        id: 'test-v15-aesthetic',
        short_code: 'CAS-999',
        createdAt: new Date(),
        customer_name: 'Patrick Siqueira (Teste Visual)',
        customer_email: 'patricksiqueira.developer@gmail.com',
        customer_phone: '(48) 99999-9999',
        customer_empresa: 'Casulo Design Office',
        vendedor: 'Sistema Automático',
        total_price: 15750.00,
        customer_tags: ['aprovado'],
        line_items_json: [
            {
                title: 'Estação de Trabalho Minimalista XP',
                quantity: 5,
                price: 2500.00,
                custom_image: 'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=300'
            },
            {
                title: 'Cadeira Ergonômica Pro-V1',
                quantity: 5,
                price: 650.00,
                custom_image: 'https://images.unsplash.com/photo-1505797149-43b007664a3d?auto=format&fit=crop&w=300'
            }
        ],
        termos_contrato: `
CLÁUSULA 1 - DO OBJETO E ESCOPO
O presente contrato tem por objeto a prestação de serviços de design de interiores e fornecimento de mobiliário corporativo personalizado, conforme especificações técnicas detalhadas na proposta comercial anexa. A Casulo se compromete a entregar os produtos seguindo os mais altos padrões de qualidade e acabamento industrial.

CLÁUSULA 2 - DO PRAZO E ENTREGA
2.1. O prazo estimado para fabricação é de 45 (quarenta e cinco) dias úteis após a aprovação final do projeto executivo e confirmação do sinal de pagamento.
2.2. A entrega será realizada no endereço indicado pelo cliente, sendo de responsabilidade da Casulo a montagem técnica e ajustes finais no local, desde que o ambiente esteja preparado conforme orientações prévias.

CLÁUSULA 3 - DAS CONDIÇÕES DE PAGAMENTO
O valor total da proposta deverá ser quitado da seguinte forma: 50% como sinal na assinatura deste termo e 50% na data de entrega e montagem. Atrasos nos pagamentos ensejarão multa de 2% ao mês sobre o valor em aberto.

CLÁUSULA 4 - DA GARANTIA E ASSISTÊNCIA
Todos os produtos fornecidos pela Casulo possuem garantia de 5 (cinco) anos contra defeitos de fabricação em estruturas metálicas e de madeira, e 1 (um) ano para componentes de estofaria e acabamentos têxteis. A garantia não cobre danos decorrentes de mau uso ou limpeza inadequada.

CLÁUSULA 5 - DAS DISPOSIÇÕES GERAIS
Este termo substitui qualquer acordo anterior, oral ou escrito. Alterações no projeto após a assinatura poderão gerar custos adicionais e prorrogação nos prazos de entrega. As partes elegem o foro de Florianópolis/SC para dirimir quaisquer controvérsias.

OBSERVAÇÕES ADICIONAIS:
Estamos ansiosos para transformar seu ambiente corporativo em um espaço de alta produtividade e bem-estar.
        `
    };

    try {
        const buffer = await pdfService.getOrcamentoPDFBuffer(mockOrcamento);
        const outputPath = path.join(__dirname, 'test-pdf-visual.pdf');
        fs.writeFileSync(outputPath, buffer);
        console.log(`✅ PDF gerado com sucesso em: ${outputPath}`);
    } catch (err) {
        console.error('❌ Erro na geração:', err);
    }
}

testPdf();
