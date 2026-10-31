import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface NotificacionAttributes {
  id: number;
  mensaje: string;
  tipo: string;
  usuario_id: number;
  origen?: string;
  clave_evento?: string | null;
  faena_id?: number;
  fecha?: Date;
  leido: boolean;
  activo: boolean;
}

interface NotificacionCreationAttributes
  extends Optional<NotificacionAttributes, 'id' | 'origen' | 'clave_evento' | 'faena_id' | 'fecha'> {}

export class NotificacionModel
  extends Model<NotificacionAttributes, NotificacionCreationAttributes>
  implements NotificacionAttributes {
  public id!: number;
  public mensaje!: string;
  public tipo!: string;
  public usuario_id!: number;
  public origen?: string;
  public clave_evento?: string | null;
  public faena_id?: number;
  public fecha!: Date;
  public leido!: boolean;
  public activo!: boolean;
}

export const Notificacion = sequelize.define<NotificacionModel>('notificacion', {
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  mensaje: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    references: {
      model: 'usuarios',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  origen: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  clave_evento: {
    type: DataTypes.STRING(191),
    allowNull: true,
  },
  faena_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
    references: {
      model: 'faenas',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  },
  fecha: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  leido: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'notificaciones',
  timestamps: false,
});
