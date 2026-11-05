import { Request, Response } from 'express';
import { Inspeccion } from '../models';
import { avisarInspeccion } from '../services/notificacionesAutomaticas.service';

// Obtener todas las inspecciones activas con relaciones
export const obtenerInspecciones = async (_req: Request, res: Response) => {
  try {
    const inspecciones = await Inspeccion.findAll({
      where: { activo: true },
      include: [
        { association: 'faena' },
        { association: 'inspector' },
      ],
    });

    res.json(inspecciones);
  } catch (error) {
    console.error('Error al obtener inspecciones:', error);
    res.status(500).json({
      mensaje: '❌ Error al obtener inspecciones',
    });
  }
};

// Crear una nueva inspección
export const crearInspeccion = async (req: Request, res: Response) => {
  try {
    const nueva = await Inspeccion.create(req.body);

    // Notificar sin impedir que se registre la inspección.
    try {
      await avisarInspeccion({
        inspeccionId: nueva.id,
        faenaId: Number(nueva.faena_id),
        inspectorId: nueva.inspector_id == null
          ? null
          : Number(nueva.inspector_id),
        tipo: nueva.tipo,
        descripcion: nueva.descripcion,
      });
    } catch (errorNotificacion) {
      console.error(
        'Inspección creada, pero falló la notificación:',
        errorNotificacion
      );
    }

    res.status(201).json(nueva);
  } catch (error) {
    console.error('Error al crear inspección:', error);
    res.status(400).json({
      mensaje: '❌ Error al crear inspección',
    });
  }
};

// Actualizar una inspección
export const actualizarInspeccion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [actualizada] = await Inspeccion.update(req.body, {
      where: { id },
    });

    if (actualizada) {
      const inspeccion = await Inspeccion.findByPk(id);
      res.json(inspeccion);
    } else {
      res.status(404).json({
        mensaje: 'Inspección no encontrada',
      });
    }
  } catch (error) {
    console.error('Error al actualizar inspección:', error);
    res.status(400).json({
      mensaje: '❌ Error al actualizar inspección',
    });
  }
};

// Eliminar (soft delete) una inspección
export const eliminarInspeccion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [resultado] = await Inspeccion.update(
      { activo: false },
      { where: { id } }
    );

    if (resultado) {
      res.json({
        mensaje: '✅ Inspección eliminada correctamente',
      });
    } else {
      res.status(404).json({
        mensaje: 'Inspección no encontrada',
      });
    }
  } catch (error) {
    console.error('Error al eliminar inspección:', error);
    res.status(500).json({
      mensaje: '❌ Error al eliminar inspección',
    });
  }
};
