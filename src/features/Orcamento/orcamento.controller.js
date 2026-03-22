const orcamentoService = require('./orcamento.service');

class OrcamentoController {
  async create(req, res) {
    const startTime = Date.now();
    console.log(`\n[${new Date().toISOString()}] >>> [CONTROLLER]: Recebendo solicitação de orçamento...`);
    
    try {
      const payloadSize = JSON.stringify(req.body).length;
      console.log(`[${new Date().toISOString()}] [CONTROLLER]: Tamanho do Payload: ${(payloadSize / 1024 / 1024).toFixed(2)} MB`);

      // Fallback para customer_id da query (App Proxy)
      if (!req.body.customer_id && req.query.logged_in_customer_id) {
        req.body.customer_id = req.query.logged_in_customer_id;
        console.log(`[CONTROLLER INFO]: Usando customer_id da query: ${req.body.customer_id}`);
      }

      const orcamento = await orcamentoService.createOrcamento(req.body);
      
      const dbTime = Date.now();
      console.log(`[${new Date().toISOString()}] [CONTROLLER]: Registro no DB concluído em ${dbTime - startTime}ms`);

      // Enviar resposta IMEDIATAMENTE
      res.status(201).json(orcamento);
      console.log(`[${new Date().toISOString()}] <<< [CONTROLLER]: Resposta 201 enviada em ${Date.now() - startTime}ms`);
      
      // Enfileirar para sincronização com o Bling (Background)
      const syncService = require('./sync.service');
      syncService.enqueue(orcamento.id).catch(err => {
        console.error(`[${new Date().toISOString()}] [CONTROLLER]: Erro no enfileiramento:`, err.message);
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [CONTROLLER ERROR]:`, error);
      res.status(500).json({ error: 'Erro interno ao processar orçamento' });
    }
  }

  async listByCustomer(req, res) {
    try {
      const { customer_id } = req.params;
      const orcamentos = await orcamentoService.getOrcamentosByCustomer(customer_id);
      res.json(orcamentos);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao listar orçamentos' });
    }
  }

  async generatePDF(req, res) {
    try {
      const { id } = req.params;
      const orcamento = await orcamentoService.getOrcamentoById(id);
      
      if (!orcamento) return res.status(404).json({ error: 'Orçamento não encontrado' });

      // Configurar headers para download do PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=proposta-casulo-${id}.pdf`);

      // Gerar e streamar o PDF direto para a resposta
      const pdfService = require('./pdf.service');
      await pdfService.generateOrcamentoPDF(orcamento, res);
      
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao gerar PDF' });
      }
    }
  }

  /**
   * Serve a imagem temporária de forma segura para o Bling
   */
  async serveTempImage(req, res) {
    try {
      const { token, filename } = req.params;
      const SyncQueue = require('../../models/SyncQueue');
      const path = require('path');
      const fs = require('fs');

      // 1. Validar Token e Nome de Arquivo
      const job = await SyncQueue.findOne({
        where: { secret_token: token, local_filename: filename }
      });

      if (!job) {
        return res.status(403).json({ error: 'Acesso negado ou token expirado' });
      }

      // 2. Localizar arquivo físico
      const filePath = path.join(__dirname, '../../temp/images', filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Imagem não encontrada ou já deletada' });
      }

      // 3. Streamar arquivo
      const ext = path.extname(filename).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      fs.createReadStream(filePath).pipe(res);

    } catch (error) {
      console.error('Erro ao servir imagem temporária:', error.message);
      res.status(500).json({ error: 'Erro interno ao servir imagem' });
    }
  }

  /**
   * Recebe snapshots de imagem em uma requisição separada (Bypass 504 Timeout)
   */
  async uploadSnapshot(req, res) {
    const startTime = Date.now();
    const { id } = req.params;
    const { base64Map } = req.body;

    console.log(`\n[${new Date().toISOString()}] >>> [CONTROLLER]: Recebendo Snapshot tardio para Orçamento: ${id}`);

    try {
      if (!base64Map || Object.keys(base64Map).length === 0) {
        return res.status(400).json({ error: 'Nenhum snapshot enviado' });
      }

      // Processar e salvar no disco (Isso atualiza o DB também)
      await orcamentoService.saveBase64ImagesAfterCreation(id, base64Map);

      console.log(`[${new Date().toISOString()}] <<< [CONTROLLER]: Snapshots processados em ${Date.now() - startTime}ms`);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [CONTROLLER ERROR]:`, error.message);
      res.status(500).json({ error: 'Erro ao processar snapshots' });
    }
  }
  /**
   * Rota de Teste para gerar PDF sem filtros de segurança
   */
  async testGeneratePDF(req, res) {
    try {
      const { id } = req.params;
      const orcamento = await orcamentoService.getOrcamentoById(id);
      
      if (!orcamento) return res.status(404).json({ error: 'Orçamento não encontrado' });

      console.log(`[PDF TEST]: Gerando PDF para orçamento #${id}`);

      // Configurar headers para download do PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=test-proposta-${id}.pdf`);

      const pdfService = require('./pdf.service');
      await pdfService.generateOrcamentoPDF(orcamento, res);
      
    } catch (error) {
      console.error('Erro ao gerar PDF de teste:', error);
      res.status(500).send('Erro ao gerar PDF: ' + error.message);
    }
  }
  /**
   * Serve a imagem capturada para o Meus Orçamentos (via Proxy)
   */
  async serveImage(req, res) {
    try {
      const { id, index } = req.params;
      const path = require('path');
      const fs = require('fs');

      const filename = `snapshot-${id}-${index}.png`;
      const filePath = path.join(__dirname, '../../temp/images', filename);

      if (!fs.existsSync(filePath)) {
        console.warn(`[ORCAMENTO CONTROLLER]: Snapshot não encontrado: ${filename}`);
        return res.status(404).send('Imagem não encontrada');
      }

      const stat = fs.statSync(filePath);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=604800'); // Cache por 7 dias

      fs.createReadStream(filePath).pipe(res);

    } catch (error) {
      console.error('[ORCAMENTO CONTROLLER]: Erro ao servir imagem:', error.message);
      res.status(500).send('Erro interno ao servir imagem');
    }
  }
  /**
   * Sincroniza um item do carrinho (Página do Produto -> API)
   * Salva a imagem e associa ao customer e variant
   */
  async syncItem(req, res) {
    console.log(`\n[${new Date().toISOString()}] >>> [SYNC REQ]: Recebendo sincronização de item...`);
    
    // Fallback para customer_id da query (App Proxy)
    const customer_id = req.body.customer_id || req.query.logged_in_customer_id;
    const variant_id = req.body.variant_id;
    const product_id = req.body.product_id;
    const { image, technical_specification } = req.body;

    console.log(`[SYNC DEBUG]: Customer ID: ${customer_id}, Variant ID: ${variant_id}, Product ID: ${product_id}`);

    if (!customer_id || !variant_id) {
      console.warn('[SYNC WARNING]: customer_id ou variant_id ausentes!');
      return res.status(400).json({ error: 'customer_id e variant_id são obrigatórios' });
    }

    try {
      const CartItem = require('../../models/CartItem');
      const path = require('path');
      const fs = require('fs');

      // 1. Salvar imagem no disco (temp/images)
      let imageUrl = null;
      if (image && image.startsWith('data:image')) {
        console.log(`[SYNC DEBUG]: Processando imagem Base64 (${(image.length / 1024).toFixed(1)} KB)`);
        const imagesDir = path.join(__dirname, '../../temp/images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

        const filename = `sync-${customer_id}-${variant_id}.png`;
        const filePath = path.join(imagesDir, filename);
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        
        imageUrl = `/apps/orcamento/sync-image/${customer_id}/${variant_id}`;
        console.log(`[SYNC SUCCESS]: Imagem salva em disco: ${filename}`);
      } else {
        console.warn('[SYNC WARNING]: Nenhuma imagem Base64 recebida para sincronização.');
      }

      // 2. Atualizar ou Criar registro no DB
      console.log('[SYNC DB]: Buscando/Criando registro no banco de dados...');
      const [item, created] = await CartItem.findOrCreate({
        where: { shopify_customer_id: customer_id.toString(), variant_id: variant_id.toString() },
        defaults: {
          product_id: product_id ? product_id.toString() : null,
          technical_specification,
          image_url: imageUrl,
          last_snapshot: image
        }
      });

      if (!created) {
        console.log('[SYNC DB]: Registro existente encontrado. Atualizando...');
        await item.update({
          product_id: product_id ? product_id.toString() : item.product_id,
          technical_specification,
          image_url: imageUrl,
          last_snapshot: image
        });
      } else {
        console.log('[SYNC DB]: Novo registro de item criado com sucesso.');
      }

      console.log(`[${new Date().toISOString()}] <<< [SYNC SUCCESS]: Item ${variant_id} sincronizado para cliente ${customer_id}`);
      res.json({ success: true, image_url: imageUrl });
    } catch (error) {
      console.error('[SYNC ERROR]:', error.message);
      res.status(500).json({ error: 'Erro ao sincronizar item' });
    }
  }
  /**
   * Serve a imagem sincronizada (staged) para o cliente/variante
   */
  async serveSyncedImage(req, res) {
    try {
      const { customer_id, variant_id } = req.params;
      const path = require('path');
      const fs = require('fs');

      const filename = `sync-${customer_id}-${variant_id}.png`;
      const filePath = path.join(__dirname, '../../temp/images', filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).send('Imagem sincronizada não encontrada');
      }

      res.setHeader('Content-Type', 'image/png');
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.status(500).send('Erro ao servir imagem sincronizada');
    }
  }
}

module.exports = new OrcamentoController();
