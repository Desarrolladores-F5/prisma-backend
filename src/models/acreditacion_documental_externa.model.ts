// src/models/acreditacion_documental_externa.model.ts

import {
  DataTypes,
  Model,
  Optional,
  Sequelize,
} from 'sequelize';

export type EstadoAcreditacionDocumentalExterna =
  | 'pendiente'
  | 'en_revision'
  | 'aprobado'
  | 'rechazado'
  | 'vencido';

export interface AcreditacionDocumentalExternaAttributes {
  id: number;

  contrato_id: number;
  requisito_id: number;
  documento_id: number;
  contrato_trabajador_id: number | null;

  fecha_emision: string | null;
  fecha_vencimiento: string | null;

  periodo_inicio: string | null;
  periodo_termino: string | null;

  estado: EstadoAcreditacionDocumentalExterna;
  observaciones: string | null;

  presentado_por: number;
  revisado_por: number | null;

  fecha_presentacion: Date;
  fecha_revision: Date | null;
}

export interface AcreditacionDocumentalExternaCreationAttributes
  extends Optional<
    AcreditacionDocumentalExternaAttributes,
    | 'id'
    | 'contrato_trabajador_id'
    | 'fecha_emision'
    | 'fecha_vencimiento'
    | 'periodo_inicio'
    | 'periodo_termino'
    | 'estado'
    | 'observaciones'
    | 'revisado_por'
    | 'fecha_presentacion'
    | 'fecha_revision'
  > {}

export class AcreditacionDocumentalExterna
  extends Model<
    AcreditacionDocumentalExternaAttributes,
    AcreditacionDocumentalExternaCreationAttributes
  >
  implements AcreditacionDocumentalExternaAttributes
{
  declare id: number;

  declare contrato_id: number;
  declare requisito_id: number;
  declare documento_id: number;
  declare contrato_trabajador_id: number | null;

  declare fecha_emision: string | null;
  declare fecha_vencimiento: string | null;

  declare periodo_inicio: string | null;
  declare periodo_termino: string | null;

  declare estado: EstadoAcreditacionDocumentalExterna;
  declare observaciones: string | null;

  declare presentado_por: number;
  declare revisado_por: number | null;

  declare fecha_presentacion: Date;
  declare fecha_revision: Date | null;
}

export function initAcreditacionDocumentalExterna(
  sequelize: Sequelize
): typeof AcreditacionDocumentalExterna {
  AcreditacionDocumentalExterna.init(
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

      requisito_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      documento_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      contrato_trabajador_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },

      fecha_emision: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      fecha_vencimiento: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      periodo_inicio: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      periodo_termino: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        defaultValue: null,
      },

      estado: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'pendiente',
        validate: {
          isIn: [[
            'pendiente',
            'en_revision',
            'aprobado',
            'rechazado',
            'vencido',
          ]],
        },
      },

      observaciones: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
      },

      presentado_por: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      revisado_por: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },

      fecha_presentacion: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      fecha_revision: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      sequelize,
      modelName: 'AcreditacionDocumentalExterna',
      tableName: 'acreditaciones_documentales_externas',
      timestamps: false,
    }
  );

  return AcreditacionDocumentalExterna;
}
