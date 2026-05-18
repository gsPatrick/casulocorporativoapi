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
    type: DataTypes.ENUM('desconto', 'acréscimo', 'bruto'),
    allowNull: false,
    defaultValue: 'desconto'
  },
  modalidade: {
    type: DataTypes.ENUM('porcentagem', 'valor_fixo'),
    allowNull: false,
    defaultValue: 'porcentagem'
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
