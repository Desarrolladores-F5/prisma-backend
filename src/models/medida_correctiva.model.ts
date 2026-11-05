// src/models/medida_correctiva.model.ts
import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface MedidaCorrectivaAttributes {
  id: number;
  descripcion: string;
  fecha_cumplimiento: Date;
  estado: string;
  prioridad: string;
  evidencia_documento_id?: number;
  responsable_id?: number;
  faena_id?: number | null;
  fecha_creacion?: Date;
}

interface MedidaCorrectivaCreationAttributes
  extends Optional<MedidaCorrectivaAttributes, 'id' | 'evidencia_documento_id' | 'responsable_id' | 'faena_id' | 'fecha_creacion'> {}

export class MedidaCorrectivaModel
  extends Model<MedidaCorrectivaAttributes, MedidaCorrectivaCreationAttributes>
  implements MedidaCorrectivaAttributes
{
  public id!: number;
  public descripcion!: string;
  public fecha_cumplimiento!: Date;
  public estado!: string;
  public prioridad!: string;
  public evidencia_documento_id?: number;
  public responsable_id?: number;
  public faena_id?: number | null;
  public fecha_creacion!: Date;
}

export const MedidaCorrectiva = sequelize.define<MedidaCorrectivaModel>('medida_correctiva', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  fecha_cumplimiento: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  estado: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  prioridad: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  evidencia_documento_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    references: {
      model: 'documentos',
      key: 'id',
    },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  },
  responsable_id: {
    type: DataTypes.INTEGER,
    allowNull: true, 
    references: {
      model: 'usuarios',
      key: 'id',
    },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  },
  faena_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    references: {
      model: 'faenas',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
  },
  fecha_creacion: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'medidas_correctivas',
  timestamps: false,
});
