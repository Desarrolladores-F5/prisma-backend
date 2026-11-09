import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';

import { Faena, Usuario } from '../models';

type TipoAsignacion = 'usuarios' | 'rol' | 'todos';

interface SolicitudDestinatarios {
  administradorId: number;
  asignacionTipo: TipoAsignacion;
  usuarioIds?: number[];
  rolId?: number;
}

export interface OpcionesEmpresaAdministrador {
  transaction?: Transaction;
}

export class ErrorAsignacionDocumental extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorAsignacionDocumental';
  }
}

const idValido = (id: unknown): id is number =>
  typeof id === 'number' &&
  Number.isSafeInteger(id) &&
  id > 0;

/**
 * Obtiene la empresa real del administrador desde MySQL.
 *
 * Nunca confía en un empresa_id enviado por el frontend.
 *
 * El segundo parámetro es opcional para mantener
 * compatibilidad con todos los módulos existentes.
 *
 * Cuando se proporciona una transacción, las consultas
 * de Usuario y Faena utilizan esa misma transacción.
 */
export const obtenerEmpresaAdministrador = async (
  administradorId: number,
  opciones: OpcionesEmpresaAdministrador = {}
): Promise<number> => {
  if (!idValido(administradorId)) {
    throw new ErrorAsignacionDocumental(
      401,
      'Administrador inválido.'
    );
  }

  const opcionesTransaccion = opciones.transaction
    ? { transaction: opciones.transaction }
    : {};

  const administrador = await Usuario.findByPk(administradorId, {
    attributes: ['id', 'rol_id', 'activo', 'faena_id'],
    ...opcionesTransaccion,
  });

  if (
    !administrador ||
    administrador.rol_id !== 1 ||
    administrador.activo !== true ||
    !idValido(administrador.faena_id)
  ) {
    throw new ErrorAsignacionDocumental(
      403,
      'Administrador sin autorización o faena válida.'
    );
  }

  const faena = await Faena.findByPk(administrador.faena_id, {
    attributes: ['id', 'empresa_id'],
    ...opcionesTransaccion,
  });

  const empresaId = Number(faena?.get('empresa_id'));

  if (!idValido(empresaId)) {
    throw new ErrorAsignacionDocumental(
      403,
      'No fue posible identificar la empresa del administrador.'
    );
  }

  return empresaId;
};

export const resolverDestinatariosDocumento = async ({
  administradorId,
  asignacionTipo,
  usuarioIds = [],
  rolId,
}: SolicitudDestinatarios): Promise<number[]> => {
  if (!idValido(administradorId)) {
    throw new ErrorAsignacionDocumental(
      401,
      'Administrador inválido.'
    );
  }

  if (!['usuarios', 'rol', 'todos'].includes(asignacionTipo)) {
    throw new ErrorAsignacionDocumental(
      400,
      'Tipo de asignación inválido.'
    );
  }

  if (
    asignacionTipo === 'usuarios' &&
    (
      !Array.isArray(usuarioIds) ||
      usuarioIds.length === 0 ||
      !usuarioIds.every(idValido)
    )
  ) {
    throw new ErrorAsignacionDocumental(
      400,
      'Destinatarios inválidos.'
    );
  }

  if (
    (asignacionTipo === 'rol' || asignacionTipo === 'todos') &&
    !idValido(rolId)
  ) {
    throw new ErrorAsignacionDocumental(
      400,
      'Rol inválido.'
    );
  }

  const empresaId = await obtenerEmpresaAdministrador(administradorId);

  const where: Record<string, unknown> = {
    activo: true,
  };

  if (asignacionTipo === 'usuarios') {
    where.id = {
      [Op.in]: [...new Set(usuarioIds)],
    };
  } else {
    where.rol_id = rolId;
  }

  const destinatarios = await Usuario.findAll({
    attributes: ['id'],
    where,
    include: [
      {
        model: Faena,
        as: 'faena',
        attributes: [],
        required: true,
        where: {
          empresa_id: empresaId,
        },
      },
    ],
  });

  const ids = [...new Set(destinatarios.map(usuario => usuario.id))];

  if (asignacionTipo === 'usuarios') {
    const solicitados = [...new Set(usuarioIds)];

    if (
      ids.length !== solicitados.length ||
      solicitados.some(id => !ids.includes(id))
    ) {
      throw new ErrorAsignacionDocumental(
        403,
        'Uno o más destinatarios no pertenecen a la empresa o están inactivos.'
      );
    }
  }

  if (ids.length === 0) {
    throw new ErrorAsignacionDocumental(
      404,
      'No se encontraron destinatarios válidos.'
    );
  }

  return ids;
};
