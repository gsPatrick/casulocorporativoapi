const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CartItem = sequelize.define('CartItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  shopify_customer_id: {
    type: DataTypes.STRING,
    allowNull: false,
    index: true
  },
  variant_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  product_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  technical_specification: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  image_url: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // Armazenamos o base64 temporariamente ou o link final
  last_snapshot: {
    type: DataTypes.TEXT,
    allowNull: true,
  }
}, {
  timestamps: true,
  tableName: 'cart_items',
  indexes: [
    {
      unique: true,
      fields: ['shopify_customer_id', 'variant_id']
    }
  ]
});

module.exports = CartItem;
