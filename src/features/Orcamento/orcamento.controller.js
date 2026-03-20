const orcamentoService = require('./orcamento.service');

class OrcamentoController {
  async create(req, res) {
    const startTime = Date.now();
    console.log(`\n[${new Date().toISOString()}] >>> [CONTROLLER]: Recebendo solicitação de orçamento...`);
    
    try {
      const payloadSize = JSON.stringify(req.body).length;
      console.log(`[${new Date().toISOString()}] [CONTROLLER]: Tamanho do Payload: ${(payloadSize / 1024 / 1024).toFixed(2)} MB`);

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
}

module.exports = new OrcamentoController();
