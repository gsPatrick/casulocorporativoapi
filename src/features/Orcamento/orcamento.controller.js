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
    
    const customer_id = req.body.customer_id || req.query.logged_in_customer_id;
    const browser_id = req.body.browser_id;
    const variant_id = req.body.variant_id;
    const angle3d_id = req.body.angle3d_id; // Novo
    const product_id = req.body.product_id;
    const { image, technical_specification } = req.body;
    const product_type = req.body.product_type || 'orcamento'; // Novo: loja ou orcamento

    console.log(`[SYNC DEBUG]: Customer ID: ${customer_id}, Browser ID: ${browser_id}, Variant ID: ${variant_id}${angle3d_id ? ', Angle3D ID: ' + angle3d_id : ''}, Type: ${product_type}`);

    if ((!customer_id && !browser_id) || (!variant_id && !angle3d_id)) {
      console.warn('[SYNC WARNING]: identificação ou variante ausentes!');
      return res.status(400).json({ error: 'ID do cliente/navegador e variant_id/angle3d_id são obrigatórios' });
    }

    try {
      const CartItem = require('../../models/CartItem');
      const path = require('path');
      const fs = require('fs');

      // 1. Salvar imagem no disco
      let imageUrl = null;
      if (image && image.startsWith('data:image')) {
        const imagesDir = path.join(__dirname, '../../temp/images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

        const syncId = customer_id || browser_id;
        // Se for bundle, usamos o angle3d_id no nome do arquivo para maior precisão
        const fileId = angle3d_id || variant_id;
        const filename = `sync-${syncId}-${fileId}.png`;
        const filePath = path.join(imagesDir, filename);
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        
        imageUrl = customer_id ? `/apps/orcamento/sync-image/${customer_id}/${fileId}` : null;
      }

      // 2. Atualizar ou Criar registro no DB
      // IMPORTANTE: Sincronizamos usando tanto o variant_id quanto o angle3d_id
      const idsToSync = [variant_id, angle3d_id].filter(Boolean);
      
      for (const currentVid of idsToSync) {
        const where = customer_id ? 
          { shopify_customer_id: customer_id.toString(), variant_id: currentVid.toString() } : 
          { browser_id: browser_id.toString(), variant_id: currentVid.toString() };

        const [item, created] = await CartItem.findOrCreate({
          where,
          defaults: {
            shopify_customer_id: customer_id ? customer_id.toString() : null,
            browser_id: browser_id ? browser_id.toString() : null,
            product_id: product_id ? product_id.toString() : null,
            technical_specification,
            image_url: imageUrl,
            last_snapshot: image,
            product_type: product_type
          }
        });

        if (!created) {
          await item.update({
            product_id: product_id ? product_id.toString() : item.product_id,
            technical_specification,
            image_url: imageUrl,
            last_snapshot: image,
            product_type: product_type
          });
        }
      }

      console.log(`[${new Date().toISOString()}] <<< [SYNC SUCCESS]: Item ${variant_id} (${product_type}) sincronizado.`);
      res.json({ success: true, image_url: imageUrl });
    } catch (error) {
      console.error('[SYNC ERROR]:', error.message);
      res.status(500).json({ error: 'Erro ao sincronizar item' });
    }
  }

  /**
   * Valida se um novo item é compatível com o carrinho virtual atual (v4.3.0)
   */
  async validateAddition(req, res) {
    console.log(`\n[${new Date().toISOString()}] >>> [VALIDATE REQ]: Verificando compatibilidade de carrinho...`);
    
    const customer_id = req.body.customer_id || req.query.logged_in_customer_id;
    const browser_id = req.body.browser_id;
    const new_type = req.body.product_type; // 'loja' ou 'orcamento'

    if ((!customer_id && !browser_id) || !new_type) {
      return res.status(400).json({ error: 'Identificação e tipo do produto são obrigatórios' });
    }

    try {
      const CartItem = require('../../models/CartItem');
      const { Op } = require('sequelize');

      // Buscar todos os itens no carrinho do usuário
      const items = await CartItem.findAll({
        where: {
          [Op.or]: [
            { shopify_customer_id: customer_id ? customer_id.toString() : '___null___' },
            { browser_id: browser_id ? browser_id.toString() : '___null___' }
          ]
        }
      });

      if (items.length === 0) {
        return res.json({ valid: true, message: 'Carrinho vazio' });
      }

      // Verificar se existe algum item com tipo diferente
      const conflictingItem = items.find(item => item.product_type !== new_type);

      if (conflictingItem) {
        console.warn(`[VALIDATE]: Bloqueio detectado! Tentativa de adicionar ${new_type} em carrinho com ${conflictingItem.product_type}`);
        return res.json({ 
          valid: false, 
          message: conflictingItem.product_type === 'loja' ? 
            'Seu carrinho já possui produtos de Loja. Finalize a compra ou remova os itens para solicitar orçamentos.' : 
            'Seu carrinho já possui solicitações de orçamento. Finalize o pedido ou remova os itens para comprar produtos de Loja.'
        });
      }

      res.json({ valid: true });
    } catch (error) {
      console.error('[VALIDATE ERROR]:', error.message);
      res.status(500).json({ valid: false, error: 'Erro ao validar compatibilidade do carrinho' });
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

  /**
   * Redireciona de uma URL curta (ex: /orcamento/ABC123) para a URL longa do Angle3D
   */
  async redirectToConfig(req, res) {
    try {
      const { codigo } = req.params;
      const orcamento = await orcamentoService.getOrcamentoByShortCode(codigo);

      if (!orcamento) {
        return res.status(404).send('Orçamento não encontrado');
      }

      // Conforme briefing: Redirecionamento direto para a URL longa do configurador
      const firstItem = orcamento.line_items_json[0];
      const targetUrl = firstItem?.configuration_url;

      if (!targetUrl) {
        return res.status(400).send('URL de configuração não encontrada neste orçamento');
      }

      console.log(`[SHORT URL]: Redirecionando ${codigo} -> ${targetUrl}`);
      res.redirect(targetUrl);
    } catch (error) {
      console.error('[ORCAMENTO CONTROLLER]: Erro no redirecionamento:', error.message);
      res.status(500).send('Erro interno ao redirecionar');
    }
  }

  /**
   * Verifica quais variantes possuem snapshots salvos (v4.1.0)
   */
  async checkSnapshots(req, res) {
    try {
      const identifier = req.body.identifier || req.query.logged_in_customer_id;
      const { variant_ids } = req.body;
      const CartItem = require('../../models/CartItem');
      const { Op } = require('sequelize');

      if (!identifier || !Array.isArray(variant_ids)) {
        return res.status(400).json({ error: 'identifier e variant_ids (array) são obrigatórios' });
      }

      const items = await CartItem.findAll({
        where: {
          [Op.or]: [
            { shopify_customer_id: identifier.toString() },
            { browser_id: identifier.toString() }
          ],
          [Op.or]: [
            { variant_id: { [Op.in]: variant_ids.map(v => v.toString()) } },
            { product_id: { [Op.in]: variant_ids.map(v => v.toString()) } }
          ]
        }
      });

      const foundVariants = items.map(i => i.variant_id);
      res.json({ found: foundVariants });
    } catch (error) {
      console.error('[ORCAMENTO CONTROLLER]: Erro ao verificar snapshots:', error.message);
      res.status(500).send('Erro interno ao verificar snapshots');
    }
  }
  /**
   * Limpa o carrinho virtual de um usuário (v4.3.0)
   */
  async clearCart(req, res) {
    console.log(`\n[${new Date().toISOString()}] >>> [CLEAR REQ]: Limpando carrinho virtual...`);
    
    const customer_id = req.body.customer_id || req.query.logged_in_customer_id;
    const browser_id = req.body.browser_id;

    if (!customer_id && !browser_id) {
      return res.status(400).json({ error: 'Identificação do usuário é obrigatória' });
    }

    try {
      const CartItem = require('../../models/CartItem');
      const { Op } = require('sequelize');

      await CartItem.destroy({
        where: {
          [Op.or]: [
            { shopify_customer_id: customer_id ? customer_id.toString() : '___null___' },
            { browser_id: browser_id ? browser_id.toString() : '___null___' }
          ]
        }
      });

      res.json({ success: true, message: 'Carrinho virtual limpo' });
    } catch (error) {
      console.error('[CLEAR ERROR]:', error.message);
      res.status(500).json({ error: 'Erro ao limpar carrinho virtual' });
    }
  }
}

module.exports = new OrcamentoController();
