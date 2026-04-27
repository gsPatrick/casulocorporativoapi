const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Orcamento = sequelize.define('Orcamento', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  shopify_customer_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  lead_json: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  line_items_json: {
    type: DataTypes.JSONB,
    allowNull: false,
  },
  total_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  original_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
  },
  discount_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0,
  },
  short_code: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  vendedor: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  parceiro: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pendente', // pendente, analise, enviado, aprovado, cancelado
  },
  pdf_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_phone: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_type: {
    type: DataTypes.STRING,
    defaultValue: 'convidado', // logado, convidado
  },
  customer_tags: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  discount_category: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  termos_contrato: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  condicao_json: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
  customer_cnpj: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_company: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_address: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_cep: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  customer_code: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  custom_id: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  sequence_number: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  hidden_for_customer: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  show_prices_to_customer: {
    type: DataTypes.BOOLEAN,
    defaultValue: false, // Por padrão, oculta até o admin liberar
  },
}, {
  timestamps: true,
  tableName: 'orcamentos',
});

module.exports = Orcamento;
