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
    doc.fontSize(10).text(`ID do Cliente Shopify: ${orcamento.shopify_customer_id}`);
    doc.moveDown();

    // --- Items Table ---
    doc.fontSize(14).text('Itens do Orçamento', { underline: true });
    doc.moveDown(0.5);

    const tableTop = 200;
    doc.fontSize(10);
    this.generateTableRow(doc, tableTop, 'Produto', 'Qtd', 'Preço Unit.', 'Total');
    this.generateHr(doc, tableTop + 15);

    let i = 0;
    for (const item of orcamento.line_items_json) {
      const y = tableTop + 25 + (i * 25);
      const title = item.type === 'configurable' ? `[Config] ${item.product_id}` : item.title;
      const unitPrice = 100.00; // Dummy price logic compatible with previous service
      const lineTotal = unitPrice * item.quantity;

      this.generateTableRow(doc, y, title, item.quantity.toString(), `R$ ${unitPrice.toFixed(2)}`, `R$ ${lineTotal.toFixed(2)}`);
      this.generateHr(doc, y + 15);
      i++;
    }

    const subtotalPosition = tableTop + 25 + (i * 25) + 20;
    doc.fontSize(12).text(`Total Geral: R$ ${parseFloat(orcamento.total_price).toFixed(2)}`, 400, subtotalPosition, { align: 'right', bold: true });

    // --- Configuration Previews (Images) ---
    let imageY = subtotalPosition + 50;
    for (const item of orcamento.line_items_json) {
      if (item.customizer_state && item.customizer_state.preview_image) {
        if (imageY + 200 > 750) {
          doc.addPage();
          imageY = 50;
        }

        doc.fontSize(12).text(`Preview da Configuração (${item.product_id}):`, 50, imageY);
        try {
          // Nota: Para renderizar imagem de URL, o pdfkit precisa baixar o buffer
          const response = await axios.get(item.customizer_state.preview_image, { responseType: 'arraybuffer' });
          doc.image(response.data, 50, imageY + 20, { width: 300 });
          imageY += 250;
        } catch (err) {
          doc.fontSize(8).fillColor('red').text('Erro ao carregar preview da imagem', 50, imageY + 20);
          doc.fillColor('black');
          imageY += 50;
        }
      }
    }

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
