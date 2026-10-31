// src/controllers/notificacion.controller.ts

import { Request, Response } from 'express';
import { Notificacion, Usuario, Faena } from '../models';

// Obtener todas las notificaciones activas con relaciones
export const obtenerNotificaciones = async (_req: Request, res: Response): Promise<void> => {
  try {
    const registros = await Notificacion.findAll({
      where: { activo: true },
      include: [
        { model: Usuario, as: 'usuario', attributes: ['nombre', 'apellido'] },
        { model: Faena, as: 'faena', attributes: ['nombre'] },
      ],
      order: [['fecha', 'DESC']],
    });

    res.json(registros);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener notificaciones', error });
  }
};

// Crear una nueva notificación
export const crearNotificacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const nueva = await Notificacion.create(req.body);
    res.status(201).json(nueva);
  } catch (error) {
    res.status(400).json({ mensaje: '❌ Error al crear notificación', error });
  }
};

// Actualizar una notificación (por ejemplo, marcar como leída)
export const actualizarNotificacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [actualizada] = await Notificacion.update(req.body, { where: { id } });

    if (actualizada) {
      const notificacion = await Notificacion.findByPk(id, {
        include: [
          { model: Usuario, as: 'usuario', attributes: ['nombre', 'apellido'] },
          { model: Faena, as: 'faena', attributes: ['nombre'] },
        ],
      });
      res.json(notificacion);
    } else {
      res.status(404).json({ mensaje: 'Notificación no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al actualizar notificación', error });
  }
};

// Eliminar (soft delete) una notificación
export const eliminarNotificacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [resultado] = await Notificacion.update({ activo: false }, { where: { id } });

    if (resultado) {
      res.json({ mensaje: '✅ Notificación eliminada correctamente (soft delete)' });
    } else {
      res.status(404).json({ mensaje: 'Notificación no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al eliminar notificación', error });
  }
};

// Obtener notificaciones propias del usuario autenticado
export const obtenerMisNotificaciones = async (req: Request, res: Response): Promise<void> => {
  try {
    const { usuario } = req;

    if (!usuario?.id) {
      res.status(401).json({ mensaje: 'Usuario no autenticado' });
      return;
    }

    const notificaciones = await Notificacion.findAll({
      where: { usuario_id: usuario.id, activo: true },
      order: [['fecha', 'DESC']],
    });

    res.json(notificaciones);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener notificaciones personales', error });
  }
};

// Marcar una notificación como leída (uso del trabajador)
export const marcarComoLeida = async (req: Request, res: Response): Promise<void> => {
  try {
    const usuarioId = Number(req.usuario?.id);
    const notificacionId = Number(req.params.id);

    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
      res.status(401).json({ mensaje: 'Usuario no autenticado' });
      return;
    }

    if (!Number.isSafeInteger(notificacionId) || notificacionId <= 0) {
      res.status(400).json({ mensaje: 'Identificador de notificación inválido' });
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
      res.status(404).json({ mensaje: 'Notificación no encontrada' });
      return;
    }

    notificacion.leido = true;
    await notificacion.save();

    res.json({ mensaje: '✅ Notificación marcada como leída', notificacion });
  } catch (error) {
    console.error('❌ Error al marcar como leída:', error);
    res.status(500).json({ mensaje: 'Error al actualizar notificación', error });
  }
};
