const ejs = require('ejs');
const puppeteer = require('puppeteer');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

class PdfService {
  /**
   * Gera um PDF a partir de templates EJS usando Puppeteer para fidelidade visual total.
   */
  async generateOrcamentoPDF(orcamento, res) {
    console.log(`[PDF SERVICE]: Iniciando geração pixel-perfect para orçamento #${orcamento.id}`);
    
    try {
      // 1. Preparar dados para o template (Base64 de imagens, formatação de preços)
      const templateData = await this.prepareTemplateData(orcamento);

      // 2. Renderizar EJS para HTML
      const templatePath = path.join(__dirname, 'templates', 'main.ejs');
      const html = await ejs.renderFile(templatePath, templateData);

      // 3. Usar Puppeteer para converter HTML em PDF
      const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      try {
        const page = await browser.newPage();
        
        // Emular media type 'screen' para garantir que cores/backgrounds saiam no PDF
        await page.emulateMediaType('screen');
        
        await page.setContent(html, { 
          waitUntil: 'networkidle0',
          timeout: 30000 
        });

        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
          displayHeaderFooter: false
        });

        // 4. Enviar o buffer para a resposta Express
        res.end(pdfBuffer);

      } finally {
        await browser.close();
      }

    } catch (error) {
      console.error('[PDF SERVICE ERROR]:', error.message);
      throw error;
    }
  }

  /**
   * Prepara os dados brutos do Sequelize para o formato amigável do template EJS
   */
  async prepareTemplateData(orcamento) {
    const items = [];
    const lead = orcamento.lead_json || {};

    // Converter Logo da Casulo para Base64 (se existir)
    let logoBase64 = '';
    const logoPath = path.join(__dirname, 'templates', 'assets', 'logo.png');
    if (fs.existsSync(logoPath)) {
      logoBase64 = fs.readFileSync(logoPath).toString('base64');
    }

    // Processar cada item do orçamento
    for (const item of orcamento.line_items_json) {
      let imageBase64 = null;

      // Se houver snapshot (URL ou Base64 direto)
      if (item.custom_image && item.custom_image.startsWith('data:image')) {
        // Se for Base64 (nosso novo método Pixel-Perfect), extraímos o conteúdo puro
        imageBase64 = item.custom_image.split(',')[1] || item.custom_image;
      } 
      else if (item.custom_image && item.custom_image.startsWith('http')) {
        try {
          const imgRes = await axios.get(item.custom_image, { responseType: 'arraybuffer', timeout: 20000 });
          imageBase64 = Buffer.from(imgRes.data, 'binary').toString('base64');
        } catch (err) {
          console.warn(`[PDF SERVICE]: Falha ao processar imagem para ${item.title}`, err.message);
        }
      }

      const unitPrice = parseFloat(item.price || 0);
      const totalItem = unitPrice * (item.quantity || 1);

      items.push({
        ...item,
        custom_image_base64: imageBase64,
        unit_price_formatted: unitPrice > 0 ? `R$ ${unitPrice.toFixed(2).replace('.', ',')}` : 'Sob Consulta',
        total_price_formatted: totalItem > 0 ? `R$ ${totalItem.toFixed(2).replace('.', ',')}` : 'Sob Consulta'
      });
    }

    const totalBudget = parseFloat(orcamento.total_price || 0);

    return {
      id: orcamento.id,
      date: new Date(orcamento.createdAt).toLocaleDateString('pt-BR'),
      logoBase64,
      customer_name: lead.nome || `Cliente #${orcamento.shopify_customer_id || 'B2B'}`,
      customer_email: lead.email || 'N/A',
      customer_whatsapp: lead.whatsapp || 'N/A',
      items,
      total_formatted: totalBudget > 0 ? `R$ ${totalBudget.toFixed(2).replace('.', ',')}` : 'A Definir (B2B)'
    };
  }
}

module.exports = new PdfService();
