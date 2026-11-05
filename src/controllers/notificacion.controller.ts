// src/controllers/notificacion.controller.ts

import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Notificacion, Usuario, Faena } from '../models';
import {
  obtenerEmpresaAdministrador,
} from '../services/asignacionDocumental.service';

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

const obtenerIdAutenticado = (req: Request): number => {
  const id = Number(req.usuario?.id);
  return idValido(id) ? id : 0;
};

class ErrorAccesoNotificaciones extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
  }
}

/**
 * Obtiene las faenas autorizadas desde MySQL.
 *
 * Administrador: todas las faenas activas de su empresa.
 * Supervisor: su faena asignada, si continúa activa.
 *
 * No se confía en empresa_id ni faena_id enviados por el cliente.
 */
const obtenerFaenasAutorizadas = async (
  usuarioId: number
): Promise<number[]> => {
  if (!idValido(usuarioId)) {
    throw new ErrorAccesoNotificaciones(
      401,
      'Usuario no autenticado.'
    );
  }

  const usuario = await Usuario.findByPk(usuarioId, {
    attributes: ['id', 'rol_id', 'activo', 'faena_id'],
  });

  if (!usuario || usuario.activo !== true) {
    throw new ErrorAccesoNotificaciones(
      403,
      'Usuario sin autorización.'
    );
  }

  if (usuario.rol_id === 1) {
    const empresaId = await obtenerEmpresaAdministrador(usuarioId);

    const faenas = await Faena.findAll({
      where: {
        empresa_id: empresaId,
        activo: true,
      },
      attributes: ['id'],
    });

    return faenas.map(faena => Number(faena.get('id')));
  }

  if (usuario.rol_id === 2) {
    const faenaId = Number(usuario.faena_id);

    if (!idValido(faenaId)) {
      return [];
    }

    const faena = await Faena.findOne({
      where: {
        id: faenaId,
        activo: true,
      },
      attributes: ['id'],
    });

    return faena ? [faenaId] : [];
  }

  throw new ErrorAccesoNotificaciones(
    403,
    'Rol no autorizado.'
  );
};

/**
 * El ámbito contempla:
 * - Notificaciones vinculadas directamente a una faena autorizada.
 * - Notificaciones sin faena cuyo destinatario pertenece
 *   actualmente a una faena autorizada.
 */
const obtenerFiltroAutorizado = async (
  faenaIds: number[]
) => {
  return {
    faena_id: {
      [Op.in]: faenaIds,
    },
  };
};

const manejarError = (
  res: Response,
  error: unknown,
  mensaje: string
): void => {
  if (error instanceof ErrorAccesoNotificaciones) {
    res.status(error.estadoHttp).json({
      mensaje: error.message,
    });
    return;
  }

  console.error(mensaje, error);

  res.status(500).json({
    mensaje,
  });
};

// Administrador y supervisor: obtener notificaciones de su ámbito.
export const obtenerNotificaciones = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const faenaIds = await obtenerFaenasAutorizadas(
      obtenerIdAutenticado(req)
    );

    const filtro = await obtenerFiltroAutorizado(faenaIds);

    const registros = await Notificacion.findAll({
      where: {
        [Op.and]: [
          { activo: true },
          filtro,
        ],
      },
      include: [
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['nombre', 'apellido'],
        },
        {
          model: Faena,
          as: 'faena',
          attributes: ['nombre'],
        },
      ],
      order: [['fecha', 'DESC']],
    });

    res.json(registros);
  } catch (error) {
    manejarError(
      res,
      error,
      'Error al obtener notificaciones.'
    );
  }
};

// Solo administrador: crear notificación dentro de su empresa.
export const crearNotificacion = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const administradorId = obtenerIdAutenticado(req);
    const faenaIds = await obtenerFaenasAutorizadas(
      administradorId
    );

    const usuarioId = Number(req.body?.usuario_id);
    const faenaId = Number(req.body?.faena_id);
    const mensaje = req.body?.mensaje;
    const tipo = req.body?.tipo;

    if (
      !idValido(usuarioId) ||
      !idValido(faenaId) ||
      typeof mensaje !== 'string' ||
      !mensaje.trim() ||
      typeof tipo !== 'string' ||
      !tipo.trim()
    ) {
      res.status(400).json({
        mensaje: 'Datos de notificación inválidos.',
      });
      return;
    }

    if (
      !faenaIds.includes(faenaId) ||
      tipo.startsWith('alerta_vencimiento_')
    ) {
      res.status(403).json({
        mensaje: 'Operación no autorizada.',
      });
      return;
    }

    const destinatario = await Usuario.findOne({
      where: {
        id: usuarioId,
        faena_id: { [Op.in]: faenaIds },
        activo: true,
      },
      attributes: ['id'],
    });

    if (!destinatario) {
      res.status(403).json({
        mensaje: 'Destinatario fuera de la empresa autorizada.',
      });
      return;
    }

    const nueva = await Notificacion.create({
      usuario_id: usuarioId,
      faena_id: faenaId,
      mensaje: mensaje.trim(),
      tipo: tipo.trim(),
      origen: 'manual',
      leido: false,
      activo: true,
    });

    res.status(201).json(nueva);
  } catch (error) {
    manejarError(
      res,
      error,
      'Error al crear notificación.'
    );
  }
};

// Solo administrador: actualizar campos permitidos.
export const actualizarNotificacion = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    if (!idValido(id)) {
      res.status(400).json({
        mensaje: 'Identificador inválido.',
      });
      return;
    }

    const faenaIds = await obtenerFaenasAutorizadas(
      obtenerIdAutenticado(req)
    );

    const filtro = await obtenerFiltroAutorizado(faenaIds);

    const notificacion = await Notificacion.findOne({
      where: {
        id,
        [Op.and]: [filtro],
      },
    });

    if (!notificacion) {
      res.status(404).json({
        mensaje: 'Notificación no encontrada.',
      });
      return;
    }

    // Las notificaciones generadas por servicios internos
    // no pueden modificarse mediante las rutas administrativas.
    if (
      notificacion.origen !== 'manual' ||
      notificacion.clave_evento != null
    ) {
      res.status(403).json({
        mensaje: 'Esta notificación es gestionada por el sistema.',
      });
      return;
    }

    const cambios: {
      mensaje?: string;
      leido?: boolean;
      activo?: boolean;
    } = {};

    if (req.body?.mensaje !== undefined) {
      if (
        typeof req.body.mensaje !== 'string' ||
        !req.body.mensaje.trim()
      ) {
        res.status(400).json({
          mensaje: 'Mensaje inválido.',
        });
        return;
      }

      cambios.mensaje = req.body.mensaje.trim();
    }

    if (req.body?.leido !== undefined) {
      if (typeof req.body.leido !== 'boolean') {
        res.status(400).json({
          mensaje: 'Valor de lectura inválido.',
        });
        return;
      }

      cambios.leido = req.body.leido;
    }

    if (req.body?.activo !== undefined) {
      if (typeof req.body.activo !== 'boolean') {
        res.status(400).json({
          mensaje: 'Valor de actividad inválido.',
        });
        return;
      }

      cambios.activo = req.body.activo;
    }

    if (Object.keys(cambios).length === 0) {
      res.status(400).json({
        mensaje: 'No se proporcionaron cambios permitidos.',
      });
      return;
    }

    await notificacion.update(cambios);

    res.json(notificacion);
  } catch (error) {
    manejarError(
      res,
      error,
      'Error al actualizar notificación.'
    );
  }
};

// Solo administrador: eliminación lógica dentro de su empresa.
export const eliminarNotificacion = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = Number(req.params.id);

    if (!idValido(id)) {
      res.status(400).json({
        mensaje: 'Identificador inválido.',
      });
      return;
    }

    const faenaIds = await obtenerFaenasAutorizadas(
      obtenerIdAutenticado(req)
    );

    const filtro = await obtenerFiltroAutorizado(faenaIds);

    const notificacion = await Notificacion.findOne({
      where: {
        id,
        [Op.and]: [filtro],
      },
    });

    if (!notificacion) {
      res.status(404).json({
        mensaje: 'Notificación no encontrada.',
      });
      return;
    }

    // Las notificaciones generadas por servicios internos
    // no pueden modificarse mediante las rutas administrativas.
    if (
      notificacion.origen !== 'manual' ||
      notificacion.clave_evento != null
    ) {
      res.status(403).json({
        mensaje: 'Esta notificación es gestionada por el sistema.',
      });
      return;
    }

    await notificacion.update({ activo: false });

    res.json({
      mensaje: 'Notificación desactivada correctamente.',
    });
  } catch (error) {
    manejarError(
      res,
      error,
      'Error al eliminar notificación.'
    );
  }
};

// Usuario autenticado: consultar únicamente sus notificaciones.
export const obtenerMisNotificaciones = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const usuarioId = obtenerIdAutenticado(req);

    if (!idValido(usuarioId)) {
      res.status(401).json({
        mensaje: 'Usuario no autenticado.',
      });
      return;
    }

    const usuario = await Usuario.findByPk(usuarioId, {
      attributes: ['id', 'activo'],
    });

    if (!usuario || usuario.activo !== true) {
      res.status(403).json({
        mensaje: 'Usuario sin autorización.',
      });
      return;
    }

    const notificaciones = await Notificacion.findAll({
      where: {
        usuario_id: usuarioId,
        activo: true,
      },
      order: [['fecha', 'DESC']],
    });

    res.json(notificaciones);
  } catch (error) {
    manejarError(
      res,
      error,
      'Error al obtener notificaciones personales.'
    );
  }
};

// Usuario autenticado: marcar únicamente sus notificaciones.
export const marcarComoLeida = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const usuarioId = obtenerIdAutenticado(req);
    const notificacionId = Number(req.params.id);

    if (!idValido(usuarioId)) {
      res.status(401).json({
        mensaje: 'Usuario no autenticado.',
      });
      return;
    }

    if (!idValido(notificacionId)) {
      res.status(400).json({
        mensaje: 'Identificador de notificación inválido.',
      });
      return;
    }

    const usuario = await Usuario.findByPk(usuarioId, {
      attributes: ['id', 'activo'],
    });

    if (!usuario || usuario.activo !== true) {
      res.status(403).json({
        mensaje: 'Usuario sin autorización.',
      });
      return;
    }

    const notificacion = await Notificacion.findOne({
      where: {
        id: notificacionId,
        usuario_id: usuarioId,
        activo: true,
      },
    });

    if (!notificacion) {
      res.status(404).json({
        mensaje: 'Notificación no encontrada.',
      });
      return;
    }

    notificacion.leido = true;
    await notificacion.save();

    res.json({
      mensaje: 'Notificación marcada como leída.',
      notificacion,
    });
  } catch (error) {
    manejarError(
      res,
      error,
      'Error al marcar notificación como leída.'
    );
  }
};
