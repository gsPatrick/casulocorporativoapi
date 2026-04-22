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
        await page.setContent(html, { waitUntil: 'load', timeout: 60000 });

        return await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
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

    // Processar Fator de Ajuste Comercial (v5.5.0 - Hidden Condition)
    let adjustmentFactor = 1;
    if (orcamento.condicao_json) {
      const v = parseFloat(orcamento.condicao_json.valor);
      adjustmentFactor = orcamento.condicao_json.tipo === 'desconto' ? (1 - v/100) : (1 + v/100);
      console.log(`[PDF SERVICE]: Diluindo Condição (${orcamento.condicao_json.tipo}: ${v}%) nos itens.`);
    }

    // Determinar visibilidade de preços (v5.5.0 - Robust Check)
    const totalBudget = parseFloat(orcamento.total_price || 0);
    const tagsRaw = orcamento.customer_tags || [];
    const tagsText = Array.isArray(tagsRaw) ? tagsRaw.join('|') : String(tagsRaw);
    const tagsLower = tagsText.toLowerCase();
    
    // Se o orçamento já tem preço total definido, LIBERA a visualização no PDF
    let canSeePrices = totalBudget > 0;
    
    if (!canSeePrices) {
      canSeePrices = tagsLower.includes('aprovado') || 
                     tagsLower.includes('cadastrado') || 
                     tagsLower.includes('acesso-temporario') ||
                     tagsLower.includes('acesso_temporario');
    }

    // Processar cada item do orçamento
    for (const item of orcamento.line_items_json) {
      let imageBase64 = item.custom_image_base64 || null;

      // ... (lógica de imagem mantida) ...

      // ... existing image processing logic ...
      if (item.custom_image && item.custom_image.startsWith('data:image')) {
        imageBase64 = item.custom_image.split(',')[1] || item.custom_image;
      } 
      else if (item.custom_image) {
        const snapshotMatch = item.custom_image.match(/images\/([\w-]+)\/(\d+)/);
        if (snapshotMatch) {
          try {
            const id = snapshotMatch[1];
            const index = snapshotMatch[2];
            const filename = `snapshot-${id}-${index}.png`;
            const filePath = path.join(__dirname, '../../temp/images', filename);
            if (fs.existsSync(filePath)) {
              imageBase64 = fs.readFileSync(filePath).toString('base64');
            }
          } catch (err) {}
        }
        if (!imageBase64 && item.custom_image.startsWith('http')) {
          try {
            const imgRes = await axios.get(item.custom_image, { responseType: 'arraybuffer', timeout: 15000 });
            imageBase64 = Buffer.from(imgRes.data, 'binary').toString('base64');
          } catch (err) {}
        }
      }

      // Garantir que o preço seja tratado como número
      let rawPrice = item.price;
      if (typeof rawPrice === 'string') {
        rawPrice = rawPrice.replace(/[^\d.,]/g, '').replace(',', '.');
      }
      
      const unitPrice = parseFloat(rawPrice || 0) * adjustmentFactor;
      const totalItem = unitPrice * (item.quantity || 1);

      // Regra de Ouro: Se não pode ver preços, mostramos 'Sob Consulta'
      const unitFormatted = canSeePrices && unitPrice > 0 ? `R$ ${unitPrice.toFixed(2).replace('.', ',')}` : 'Sob Consulta';
      const totalFormatted = canSeePrices && totalItem > 0 ? `R$ ${totalItem.toFixed(2).replace('.', ',')}` : 'Sob Consulta';

      items.push({
        ...item,
        custom_image_base64: imageBase64,
        unit_price_formatted: unitFormatted,
        total_price_formatted: totalFormatted
      });
    }

    const subtotal = parseFloat(orcamento.original_price || orcamento.total_price || 0) * adjustmentFactor;
    
    return {
      id: orcamento.id,
      date: new Date(orcamento.createdAt).toLocaleDateString('pt-BR'),
      logoBase64,
      // Sincronização Real dos Dados B2B (v5.4.0)
      customer_name: orcamento.customer_name || (lead.nome ? `${lead.nome} ${lead.sobrenome || ''}`.trim() : 'Cliente'),
      customer_company: orcamento.customer_company || lead.empresa || '',
      customer_cnpj: orcamento.customer_cnpj || lead.cnpj || '',
      customer_address: orcamento.customer_address || lead.endereco || '',
      customer_cep: orcamento.customer_cep || lead.cep || '',
      customer_email: orcamento.customer_email || lead.email || 'N/A',
      customer_whatsapp: orcamento.customer_phone || lead.whatsapp || 'N/A',
      vendedor: orcamento.vendedor || '',
      tags: tagsRaw,
      can_see_prices: canSeePrices,
      short_code: orcamento.short_code,
      items,
      condicao: null, // Ocultar do template (v5.5.0)
      subtotal_formatted: canSeePrices ? `R$ ${subtotal.toFixed(2).replace('.', ',')}` : 'Sob Consulta',
      termos_contrato: orcamento.termos_contrato || '',
      total_formatted: canSeePrices && totalBudget > 0 ? `R$ ${totalBudget.toFixed(2).replace('.', ',')}` : 'A Definir (Sob Consulta)'
    };
  }
}

module.exports = new PdfService();
