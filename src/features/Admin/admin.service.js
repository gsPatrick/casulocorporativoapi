const Setting = require('../../models/Setting');
const CustomerCodeHistory = require('../../models/CustomerCodeHistory');

class AdminService {
  async getNextCodeValue() {
    const setting = await Setting.findOne({ where: { key: 'next_customer_code' } });
    return setting ? parseInt(setting.value) : 1000; // Default starts at 1000 if not set
  }

  async updateNextCodeValue(newValue) {
    const [setting, created] = await Setting.findOrCreate({
      where: { key: 'next_customer_code' },
      defaults: { value: newValue.toString(), description: 'Contador sequencial para IDs de clientes B2B' }
    });

    if (!created) {
      await setting.update({ value: newValue.toString() });
    }
    return setting;
  }

  async generateNextCode(customerData) {
    // 1. Get current value and increment
    const setting = await Setting.findOne({ where: { key: 'next_customer_code' } });
    let currentCode = setting ? parseInt(setting.value) : 1000;
    
    const generatedCode = currentCode.toString();

    // 2. Log in history
    await CustomerCodeHistory.create({
      shopify_customer_id: customerData.id?.toString() || 'unknown',
      customer_email: customerData.email,
      customer_name: `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim(),
      generated_code: generatedCode,
      metadata: customerData
    });

    // 3. Increment and save for next time
    const nextCode = currentCode + 1;
    if (setting) {
      await setting.update({ value: nextCode.toString() });
    } else {
      await Setting.create({ key: 'next_customer_code', value: nextCode.toString() });
    }

    return generatedCode;
  }

  async processFlowSubmission(data) {
    const { id, email, first_name, last_name, form_id, ...metadata } = data;
    
    // 1. Gerar o código sequencial (mesma lógica)
    const setting = await Setting.findOne({ where: { key: 'next_customer_code' } });
    let currentCode = setting ? parseInt(setting.value) : 1000;
    const generatedCode = currentCode.toString();

    // 2. Logar no histórico com Form ID e metacampos completos
    await CustomerCodeHistory.create({
      shopify_customer_id: id?.toString() || 'unknown',
      customer_email: email,
      customer_name: `${first_name || ''} ${last_name || ''}`.trim(),
      generated_code: generatedCode,
      form_id: form_id,
      metadata: metadata // Salva CEP, CNPJ, Empresa, etc.
    });

    // 3. Incrementar contador
    const nextCode = currentCode + 1;
    if (setting) {
      await setting.update({ value: nextCode.toString() });
    } else {
      await Setting.create({ key: 'next_customer_code', value: nextCode.toString() });
    }

    return generatedCode;
  }

  async getCodeHistory(limit = 20, offset = 0) {
    return await CustomerCodeHistory.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit: limit,
      offset: offset
    });
  }

  async generateNextProposalSequence() {
    const [setting, created] = await Setting.findOrCreate({
      where: { key: 'next_proposal_sequence' },
      defaults: { value: '1', description: 'Sequencial global para orçamentos/propostas' }
    });

    const currentSeq = parseInt(setting.value);
    const nextSeq = currentSeq + 1;
    
    await setting.update({ value: nextSeq.toString() });
    
    return currentSeq;
  }
}

module.exports = new AdminService();
