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
    allowNull: false,
  },
  line_items_json: {
    type: DataTypes.JSONB,
    allowNull: false,
  },
  total_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pendente', // pendente, enviado, aprovado, cancelado
  },
  pdf_url: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  timestamps: true,
  tableName: 'orcamentos',
});

module.exports = Orcamento;
