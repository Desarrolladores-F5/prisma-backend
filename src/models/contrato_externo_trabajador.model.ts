// src/models/contrato_externo_trabajador.model.ts

import {
  DataTypes,
  Model,
  Optional,
  Sequelize,
} from 'sequelize';

export interface ContratoExternoTrabajadorAttributes {
  id: number;
  contrato_id: number;
  usuario_id: number;
  fecha_incorporacion: string | null;
  fecha_desvinculacion: string | null;
  activo: boolean;
  fecha_creacion: Date;
}

export interface ContratoExternoTrabajadorCreationAttributes
  extends Optional<
    ContratoExternoTrabajadorAttributes,
    | 'id'
    | 'fecha_incorporacion'
    | 'fecha_desvinculacion'
    | 'activo'
    | 'fecha_creacion'
  > {}

export class ContratoExternoTrabajador
  extends Model<
    ContratoExternoTrabajadorAttributes,
    ContratoExternoTrabajadorCreationAttributes
  >
  implements ContratoExternoTrabajadorAttributes
{
  declare id: number;
  declare contrato_id: number;
  declare usuario_id: number;
  declare fecha_incorporacion: string | null;
  declare fecha_desvinculacion: string | null;
  declare activo: boolean;
  declare fecha_creacion: Date;
}

export function initContratoExternoTrabajador(
  sequelize: Sequelize
): typeof ContratoExternoTrabajador {
  ContratoExternoTrabajador.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      contrato_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      fecha_incorporacion: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      fecha_desvinculacion: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      activo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      fecha_creacion: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: 'ContratoExternoTrabajador',
      tableName: 'contratos_externos_trabajadores',
      timestamps: false,
    }
  );

  return ContratoExternoTrabajador;
}
