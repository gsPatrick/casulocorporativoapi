const PDFDocument = require('pdfkit');
const axios = require('axios');

class PdfService {
  async generateOrcamentoPDF(orcamento, stream) {
    const doc = new PDFDocument({ margin: 50 });

    // Pipe the PDF to the provided stream (HTTP response)
    doc.pipe(stream);

    // --- Header / Logo ---
    // Placeholder para o logo da Casulo
    // doc.image('path/to/logo.png', 50, 45, { width: 100 });
    doc.fontSize(20).text('CASULO CORPORATIVA', 160, 50);
    doc.fontSize(10).text('Proposta Comercial B2B', 160, 75);
    doc.moveDown();

    // --- Customer Info ---
    doc.fontSize(12).text(`Orçamento ID: ${orcamento.id}`, { align: 'right' });
    doc.text(`Data: ${new Date(orcamento.createdAt).toLocaleDateString('pt-BR')}`, { align: 'right' });
    doc.moveDown();

    doc.fontSize(14).text('Informações do Cliente', { underline: true });
    if (orcamento.shopify_customer_id) {
      doc.fontSize(10).text(`ID do Cliente Shopify: ${orcamento.shopify_customer_id}`);
    } else if (orcamento.lead_json) {
      doc.fontSize(10).text(`Lead: ${orcamento.lead_json.nome}`);
      doc.text(`E-mail: ${orcamento.lead_json.email}`);
      doc.text(`WhatsApp: ${orcamento.lead_json.whatsapp}`);
    }
    doc.moveDown();

    // --- Items Table ---
    doc.fontSize(14).text('Produtos e Especificações', { underline: true });
    doc.moveDown(0.5);

    const tableTop = 200;
    doc.fontSize(10);
    this.generateTableRow(doc, tableTop, 'Produto / Especificação', 'Qtd', 'Preço', 'Total');
    this.generateHr(doc, tableTop + 15);

    let i = 0;
    let currentY = tableTop + 25;

    for (const item of orcamento.line_items_json) {
      if (currentY + 150 > 750) {
        doc.addPage();
        currentY = 50;
      }

      const title = item.title || (item.type === 'configurable' ? `Produto: ${item.product_id}` : 'Produto Padrão');
      const specs = item.technical_specification ? item.technical_specification.replace(/ \| /g, ', ') : '';
      
      const unitPrice = 0.00; // Preços sob consulta (Bling B2B flow)
      const lineTotal = unitPrice * item.quantity;

      // Renderiza Linha Principal (Título do Produto)
      doc.font('Helvetica-Bold').fontSize(11).text(title, 50, currentY);
      this.generateTableRow(doc, currentY, '', item.quantity.toString(), 'A definir', 'A definir');
      currentY += 15;

      // Renderiza Complemento (Especificação Técnica)
      if (specs) {
        doc.font('Helvetica').fontSize(9).fillColor('#444444').text(`Configuração: ${specs}`, 50, currentY, { width: 450 });
        const specLines = Math.ceil(doc.heightOfString(specs, { width: 450 }) / 9);
        currentY += (specLines * 9) + 12;
        doc.fillColor('black').fontSize(10);
      }

      // Renderiza Snapshot (Imagem) se existir
      if (item.custom_image) {
        const imgHeight = 120;
        if (currentY + imgHeight > 750) {
          doc.addPage();
          currentY = 50;
        }

        try {
          const response = await axios.get(item.custom_image, { 
            responseType: 'arraybuffer',
            timeout: 5000 // Timeout de 5s para não travar o PDF
          });
          doc.image(response.data, 50, currentY, { height: imgHeight });
          currentY += imgHeight + 10;
        } catch (err) {
          console.error('Erro ao baixar snapshot para PDF, usando fallback:', err.message);
          
          // Fallback: Desenha um box cinza com texto informativo
          doc.rect(50, currentY, 200, imgHeight).fill('#f0f0f0');
          doc.fillColor('#999999').fontSize(10).text('Imagem da configuração não disponível', 60, currentY + (imgHeight / 2) - 5);
          doc.fillColor('black'); // Reseta cor
          currentY += imgHeight + 10;
        }
      }

      this.generateHr(doc, currentY);
      currentY += 20;
      i++;
    }

    const totalY = Math.min(currentY + 20, 700);
    doc.fontSize(12).text(`Solicitação de Cotação B2B`, 400, totalY, { align: 'right', bold: true });

    // --- Footer ---
    doc.fontSize(10).text('Esta proposta é válida por 15 dias.', 50, 700, { align: 'center', width: 500 });
    
    doc.end();
  }

  generateTableRow(doc, y, item, description, amount, total) {
    doc.text(item, 50, y)
       .text(description, 280, y, { width: 30, align: 'right' })
       .text(amount, 330, y, { width: 90, align: 'right' })
       .text(total, 450, y, { align: 'right' });
  }

  generateHr(doc, y) {
    doc.strokeColor('#aaaaaa')
       .lineWidth(1)
       .moveTo(50, y)
       .lineTo(550, y)
       .stroke();
  }
}

module.exports = new PdfService();
