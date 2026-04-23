const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CustomerCodeHistory = sequelize.define('CustomerCodeHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  shopify_customer_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  customer_email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  customer_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  generated_code: {
    type: DataTypes.STRING,
    allowNull: false
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: 'customer_code_history'
});

module.exports = CustomerCodeHistory;
