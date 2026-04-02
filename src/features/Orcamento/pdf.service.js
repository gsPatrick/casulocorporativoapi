const ejs = require('ejs');
const puppeteer = require('puppeteer');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

class PdfService {
  /**
   * Gera um PDF a partir de templates EJS usando Puppeteer para fidelidade visual total.
   */
  /**
   * Gera o buffer do PDF para uso interno (anexos, etc)
   */
  async getOrcamentoPDFBuffer(orcamento) {
    console.log(`[PDF SERVICE]: Gerando Buffer para orçamento #${orcamento.id}`);
    const start = Date.now();
    
    try {
      console.log('[PDF SERVICE]: Preparando dados do template...');
      const templateData = await this.prepareTemplateData(orcamento);
      console.log('[PDF SERVICE]: Renderizando EJS...');
      const templatePath = path.join(__dirname, 'templates', 'main.ejs');
      const html = await ejs.renderFile(templatePath, templateData);

      console.log('[PDF SERVICE]: Iniciando Puppeteer...');
      const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      try {
        const page = await browser.newPage();
        await page.emulateMediaType('screen');
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

        return await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
          displayHeaderFooter: false
        });
      } finally {
        await browser.close();
      }
    } catch (error) {
      console.error('[PDF SERVICE BUFFER ERROR]:', error.message);
      throw error;
    }
  }

  /**
   * Gera um PDF e faz o stream direto para a resposta Express
   */
  async generateOrcamentoPDF(orcamento, res) {
    try {
      const pdfBuffer = await this.getOrcamentoPDFBuffer(orcamento);
      res.end(pdfBuffer);
    } catch (error) {
       console.error('[PDF SERVICE STREAM ERROR]:', error.message);
       if (!res.headersSent) res.status(500).send('Erro ao gerar PDF');
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
        // 1. Base64 direto (Pixel-Perfect)
        imageBase64 = item.custom_image.split(',')[1] || item.custom_image;
      } 
      else if (item.custom_image) {
        // 2. BUSCA ROBUSTA NO DISCO (v4.3.0)
        // Se a URL contiver o padrão de snapshot da nossa API, tentamos ler direto do disco
        const snapshotMatch = item.custom_image.match(/images\/([\w-]+)\/(\d+)/);
        
        if (snapshotMatch) {
          try {
            const id = snapshotMatch[1];
            const index = snapshotMatch[2];
            const filename = `snapshot-${id}-${index}.png`;
            const filePath = path.join(__dirname, '../../temp/images', filename);
            
            if (fs.existsSync(filePath)) {
              console.log(`[PDF SERVICE]: Snapshot encontrado no disco: ${filename}`);
              imageBase64 = fs.readFileSync(filePath).toString('base64');
            }
          } catch (err) {
            console.warn(`[PDF SERVICE]: Erro na leitura física do snapshot:`, err.message);
          }
        }

        // 3. FALLBACK: Download de Rede (Se não achou no disco ou é uma URL externa)
        if (!imageBase64 && item.custom_image.startsWith('http')) {
          try {
            console.log(`[PDF SERVICE]: Baixando imagem via rede: ${item.custom_image}`);
            const imgRes = await axios.get(item.custom_image, { 
              responseType: 'arraybuffer', 
              timeout: 15000 
            });
            imageBase64 = Buffer.from(imgRes.data, 'binary').toString('base64');
          } catch (err) {
            console.warn(`[PDF SERVICE]: Falha no download da imagem para ${item.title}:`, err.message);
          }
        }
      }

      // Garantir que o preço seja tratado como número, removendo caracteres não numéricos se necessário
      let rawPrice = item.price;
      if (typeof rawPrice === 'string') {
        rawPrice = rawPrice.replace(/[^\d.,]/g, '').replace(',', '.');
      }
      
      const unitPrice = parseFloat(rawPrice || 0);
      const totalItem = unitPrice * (item.quantity || 1);

      items.push({
        ...item,
        custom_image_base64: imageBase64,
        unit_price_formatted: unitPrice > 0 ? `R$ ${unitPrice.toFixed(2).replace('.', ',')}` : 'Sob Consulta',
        total_price_formatted: totalItem > 0 ? `R$ ${totalItem.toFixed(2).replace('.', ',')}` : 'Sob Consulta'
      });
    }

    const totalBudget = parseFloat(orcamento.total_price || 0);
    const originalBudget = parseFloat(orcamento.original_price || orcamento.total_price || 0);
    const totalDiscount = parseFloat(orcamento.discount_amount || 0);

    return {
      id: orcamento.id,
      date: new Date(orcamento.createdAt).toLocaleDateString('pt-BR'),
      logoBase64,
      customer_name: orcamento.customer_name || 'Cliente',
      customer_email: orcamento.customer_email || 'N/A',
      customer_whatsapp: orcamento.customer_phone || 'N/A',
      short_code: orcamento.short_code,
      items,
      original_formatted: originalBudget > 0 ? `R$ ${originalBudget.toFixed(2).replace('.', ',')}` : 'A Definir',
      discount_formatted: totalDiscount > 0 ? `R$ ${totalDiscount.toFixed(2).replace('.', ',')}` : null,
      discount_category: orcamento.discount_category || (totalDiscount > 0 ? 'Desconto Especial' : null),
      total_formatted: totalBudget > 0 ? `R$ ${totalBudget.toFixed(2).replace('.', ',')}` : 'A Definir (B2B)'
    };
  }
}

module.exports = new PdfService();
