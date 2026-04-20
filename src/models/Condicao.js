const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Condicao = sequelize.define('Condicao', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  nome: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.ENUM('desconto', 'acréscimo'),
    allowNull: false,
    defaultValue: 'desconto'
  },
  valor: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    get() {
      const value = this.getDataValue('valor');
      return value ? parseFloat(value) : 0;
    }
  },
  is_default: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  }
}, {
  timestamps: true,
  tableName: 'condicoes',
});

module.exports = Condicao;
