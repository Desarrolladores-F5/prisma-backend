// src/models/documento.model.ts
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface DocumentoAttributes {
  id: number;
  nombre: string;
  tipo: string;
  url: string;
  version: string;
  fecha_creacion?: Date;
  empresa_id: number | null;
}

interface DocumentoCreationAttributes
  extends Optional<
    DocumentoAttributes,
    'id' | 'fecha_creacion' | 'empresa_id'
  > {}

export class DocumentoModel
  extends Model<DocumentoAttributes, DocumentoCreationAttributes>
  implements DocumentoAttributes {
  public id!: number;
  public nombre!: string;
  public tipo!: string;
  public url!: string;
  public version!: string;
  public fecha_creacion!: Date;
  public empresa_id!: number | null;
}

export const Documento = sequelize.define<DocumentoModel>('documento', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  version: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  fecha_creacion: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  empresa_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    defaultValue: null,
  },
}, {
  tableName: 'documentos',
  timestamps: false,
});
