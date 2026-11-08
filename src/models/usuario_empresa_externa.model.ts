// src/models/usuario_empresa_externa.model.ts

import {
  DataTypes,
  Model,
  Optional,
  Sequelize,
} from 'sequelize';

export type PerfilUsuarioEmpresaExterna =
  | 'administrador_externo'
  | 'trabajador';

export interface UsuarioEmpresaExternaAttributes {
  id: number;
  usuario_id: number;
  empresa_id: number;
  perfil: PerfilUsuarioEmpresaExterna;
  activo: boolean;
  fecha_creacion: Date;
}

export interface UsuarioEmpresaExternaCreationAttributes
  extends Optional<
    UsuarioEmpresaExternaAttributes,
    'id' | 'perfil' | 'activo' | 'fecha_creacion'
  > {}

export class UsuarioEmpresaExterna
  extends Model<
    UsuarioEmpresaExternaAttributes,
    UsuarioEmpresaExternaCreationAttributes
  >
  implements UsuarioEmpresaExternaAttributes
{
  declare id: number;
  declare usuario_id: number;
  declare empresa_id: number;
  declare perfil: PerfilUsuarioEmpresaExterna;
  declare activo: boolean;
  declare fecha_creacion: Date;
}

export function initUsuarioEmpresaExterna(
  sequelize: Sequelize
): typeof UsuarioEmpresaExterna {
  UsuarioEmpresaExterna.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      usuario_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      empresa_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      perfil: {
        type: DataTypes.STRING(30),
        validate: {
          isIn: [['administrador_externo', 'trabajador']],
        },
        allowNull: false,
        defaultValue: 'trabajador',
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
      modelName: 'UsuarioEmpresaExterna',
      tableName: 'usuarios_empresas_externas',
      timestamps: false,
    }
  );

  return UsuarioEmpresaExterna;
}
