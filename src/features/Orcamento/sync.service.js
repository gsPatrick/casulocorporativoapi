const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const SyncQueue = require('../../models/SyncQueue');
const Orcamento = require('../../models/Orcamento');
const blingService = require('./bling.service');

class SyncService {
  constructor() {
    this.tempDir = path.join(__dirname, '../../temp/images');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Enfileira uma nova tarefa de sincronização
   */
  async enqueue(orcamentoId) {
    const task = await SyncQueue.create({
      orcamento_id: orcamentoId,
      status: 'pending',
      secret_token: crypto.randomBytes(16).toString('hex')
    });
    
    // Dispara o processamento em background (non-blocking)
    this.processQueue().catch(err => console.error('Erro ao iniciar worker:', err));
    
    return task;
  }

  /**
   * Baixa a imagem do Angle3D e salva localmente
   */
  async downloadAndSaveImage(url, orcamentoId) {
    const filename = `snapshot-${orcamentoId}-${Date.now()}.jpg`;
    const filePath = path.join(this.tempDir, filename);

    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
      });

      return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on('finish', () => resolve({ filename, filePath }));
        writer.on('error', reject);
      });
    } catch (error) {
      console.error('Falha ao baixar imagem do Angle3D:', error.message);
      throw error;
    }
  }

  /**
   * Deleta arquivo local com segurança (Try/Catch)
   */
  async deleteLocalFile(filePath, taskId) {
    if (!filePath || !fs.existsSync(filePath)) return;

    try {
      fs.unlinkSync(filePath);
      console.log(`Arquivo deletado: ${filePath}`);
    } catch (error) {
      console.error(`Erro ao deletar arquivo ${filePath}:`, error.message);
      // Registra no banco mas não falha o job
      await SyncQueue.update(
        { last_error: `[Cleanup Error] ${error.message}` },
        { where: { id: taskId } }
      );
    }
  }

  /**
   * Rotina de limpeza de emergência (arquivos > 24h)
   */
  async cleanupOldImages() {
    console.log('Iniciando limpeza de emergência de imagens antigas...');
    const now = Date.now();
    const ageLimit = 24 * 60 * 60 * 1000; // 24 horas

    const files = fs.readdirSync(this.tempDir);
    for (const file of files) {
      const filePath = path.join(this.tempDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > ageLimit) {
        try {
          fs.unlinkSync(filePath);
          console.log(`Limpeza: Arquivo antigo deletado: ${file}`);
        } catch (err) {
          console.error(`Falha ao limpar arquivo ${file}:`, err.message);
        }
      }
    }
  }

  /**
   * Processador da Fila (Worker)
   */
  async processQueue() {
    // 1. Limpeza de emergência antes de começar
    await this.cleanupOldImages();

    // 2. Busca tarefas pendentes
    const tasks = await SyncQueue.findAll({
      where: { status: ['pending', 'failed'] },
      limit: 5 // Processa em pequenos lotes
    });

    for (const task of tasks) {
      if (task.attempts >= 3) {
        await task.update({ status: 'failed', last_error: 'Máximo de 3 tentativas atingido.' });
        continue;
      }

      try {
        await task.update({ status: 'processing', attempts: task.attempts + 1 });

        const orcamento = await Orcamento.findByPk(task.orcamento_id);
        if (!orcamento) throw new Error('Orçamento não encontrado');

        let currentLocalFile = null;
        const itemsToSync = [];

        // Prepara os itens e imagens
        for (const item of orcamento.line_items_json) {
          let imageUrl = item.custom_image;

          if (item.type === 'configurable' && item.custom_image) {
            const { filename, filePath } = await this.downloadAndSaveImage(item.custom_image, orcamento.id);
            currentLocalFile = filePath;
            await task.update({ local_filename: filename });
            
            // Serve a imagem via URL temporária
            imageUrl = `${process.env.APP_URL}/api/temp-images/${task.secret_token}/${filename}`;
          }

          // Gera SKU baseado no produto + hash da especificação
          const skuBase = item.product_id?.split('/').pop() || 'PROD';
          const specHash = crypto.createHash('md5').update(item.technical_specification || '').digest('hex').substring(0, 8);
          const sku = `CAS-${skuBase}-${specHash}`.toUpperCase();

          // Lógica Bling: Produto -> Pedido
          let blingProd = await blingService.getProdutoByCodigo(sku);
          if (!blingProd) {
            blingProd = await blingService.createProduto({
              nome: `${skuBase} - Custom`,
              codigo: sku,
              descricao: item.technical_specification,
              imageUrl: imageUrl
            });
          }

          itemsToSync.push({ 
            codigo: sku, 
            nome: `${skuBase} Customizada`, 
            quantidade: item.quantity 
          });
        }

        // Cria Pedido no Bling
        await blingService.createPedidoVenda(orcamento, itemsToSync);

        // Limpeza de Sucesso
        await task.update({ status: 'completed', last_error: null });
        await this.deleteLocalFile(currentLocalFile, task.id);

      } catch (error) {
        console.error(`Erro ao processar task ${task.id}:`, error.message);
        await task.update({ 
          status: 'failed', 
          last_error: error.message 
        });
      }
    }
  }
}

module.exports = new SyncService();
