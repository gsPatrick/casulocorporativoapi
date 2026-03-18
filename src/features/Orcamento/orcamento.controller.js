const orcamentoService = require('./orcamento.service');

class OrcamentoController {
  async create(req, res) {
    try {
      const orcamento = await orcamentoService.createOrcamento(req.body);
      res.status(201).json(orcamento);
    } catch (error) {
      console.error('Erro ao criar orçamento:', error);
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
}

module.exports = new OrcamentoController();
