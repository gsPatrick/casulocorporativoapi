const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Conexao = sequelize.define('Conexao', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  parent_id: {
    type: DataTypes.STRING, // ID do Consultor ou Especificador (Quem convidou/criou)
    allowNull: false,
  },
  parent_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  parent_email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  child_id: {
    type: DataTypes.STRING, // ID do Cliente vinculado ou ID do outro profissional
    allowNull: false,
  },
  child_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  child_email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  type: {
    type: DataTypes.ENUM('cliente', 'profissional'),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('pendente', 'aceito', 'recusado'),
    defaultValue: 'pendente',
  }
}, {
  timestamps: true,
  tableName: 'conexoes',
});

module.exports = Conexao;
