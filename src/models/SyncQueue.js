const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SyncQueue = sequelize.define('SyncQueue', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  orcamento_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'orcamentos',
      key: 'id'
    }
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    defaultValue: 'pending'
  },
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  last_error: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  secret_token: {
    type: DataTypes.STRING,
    allowNull: true
  },
  local_filename: {
    type: DataTypes.STRING,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  }
}, {
  tableName: 'SyncQueue',
  timestamps: true
});

module.exports = SyncQueue;
