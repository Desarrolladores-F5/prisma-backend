// src/models/contrato_externo.model.ts

import {
  DataTypes,
  Model,
  Optional,
  Sequelize,
} from 'sequelize';

export interface ContratoExternoAttributes {
  id: number;
  mandante_empresa_id: number;
  contratista_empresa_id: number;
  faena_id: number;
  contrato_principal_id: number | null;
  nombre: string;
  numero_contrato: string | null;
  fecha_inicio: string | null;
  fecha_termino: string | null;
  estado: string;
  fecha_creacion: Date;
}

export interface ContratoExternoCreationAttributes
  extends Optional<
    ContratoExternoAttributes,
    | 'id'
    | 'contrato_principal_id'
    | 'numero_contrato'
    | 'fecha_inicio'
    | 'fecha_termino'
    | 'estado'
    | 'fecha_creacion'
  > {}

export class ContratoExterno
  extends Model<
    ContratoExternoAttributes,
    ContratoExternoCreationAttributes
  >
  implements ContratoExternoAttributes
{
  declare id: number;
  declare mandante_empresa_id: number;
  declare contratista_empresa_id: number;
  declare faena_id: number;
  declare contrato_principal_id: number | null;
  declare nombre: string;
  declare numero_contrato: string | null;
  declare fecha_inicio: string | null;
  declare fecha_termino: string | null;
  declare estado: string;
  declare fecha_creacion: Date;
}

export function initContratoExterno(
  sequelize: Sequelize
): typeof ContratoExterno {
  ContratoExterno.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      mandante_empresa_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      contratista_empresa_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      faena_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
      },

      contrato_principal_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },

      nombre: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      numero_contrato: {
        type: DataTypes.STRING(100),
        allowNull: true,
        defaultValue: null,
      },

      fecha_inicio: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      fecha_termino: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      estado: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'pendiente',
      },

      fecha_creacion: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: 'ContratoExterno',
      tableName: 'contratos_externos',
      timestamps: false,
    }
  );

  return ContratoExterno;
}
