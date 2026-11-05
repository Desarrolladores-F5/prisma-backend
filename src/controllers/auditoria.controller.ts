import { Request, Response } from 'express';
import { Auditoria, Faena, Usuario, Rol } from '../models';
import { avisarAuditoria } from '../services/notificacionesAutomaticas.service';

// Obtener todas las auditorías con faena y auditor (con rol)
export const obtenerAuditorias = async (_req: Request, res: Response) => {
  try {
    const auditorias = await Auditoria.findAll({
      include: [
        {
          model: Faena,
          as: 'faena',
          attributes: ['id', 'nombre']
        },
        {
          model: Usuario,
          as: 'auditor',
          attributes: ['id', 'nombre', 'apellido'],
          include: [
            {
              model: Rol,
              as: 'rol',
              attributes: ['nombre']
            }
          ]
        }
      ]
    });

    res.json(auditorias);
  } catch (error) {
    console.error('❌ Error al obtener auditorías:', error);
    res.status(500).json({ mensaje: '❌ Error al obtener auditorías', error });
  }
};

// Crear nueva auditoría
export const crearAuditoria = async (req: Request, res: Response) => {
  try {
    const nueva = await Auditoria.create(req.body);

    // Generar avisos sin afectar el registro de la auditoría.
    try {
      await avisarAuditoria({
        auditoriaId: Number(nueva.get('id')),
        faenaId: Number(nueva.get('faena_id')),
        auditorId: Number(nueva.get('auditor_id')),
        tipo: nueva.get('tipo') as string | null,
        descripcion: nueva.get('descripcion') as string | null,
      });
    } catch (errorNotificacion) {
      console.error(
        'Auditoría creada, pero no fue posible generar las notificaciones:',
        errorNotificacion
      );
    }

    res.status(201).json(nueva);
  } catch (error) {
    console.error('❌ Error al crear auditoría:', error);
    res.status(400).json({ mensaje: '❌ Error al crear auditoría', error });
  }
};

// Actualizar auditoría existente
export const actualizarAuditoria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [actualizada] = await Auditoria.update(req.body, { where: { id } });

    if (actualizada) {
      const auditoria = await Auditoria.findByPk(id, {
        include: [
          {
            model: Faena,
            as: 'faena',
            attributes: ['id', 'nombre']
          },
          {
            model: Usuario,
            as: 'auditor',
            attributes: ['id', 'nombre', 'apellido'],
            include: [
              {
                model: Rol,
                as: 'rol',
                attributes: ['nombre']
              }
            ]
          }
        ]
      });

      res.json(auditoria);
    } else {
      res.status(404).json({ mensaje: 'Auditoría no encontrada' });
    }
  } catch (error) {
    console.error('❌ Error al actualizar auditoría:', error);
    res.status(400).json({ mensaje: '❌ Error al actualizar auditoría', error });
  }
};

// Eliminar auditoría
export const eliminarAuditoria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const eliminada = await Auditoria.destroy({ where: { id } });

    if (eliminada) {
      res.json({ mensaje: '✅ Auditoría eliminada correctamente' });
    } else {
      res.status(404).json({ mensaje: 'Auditoría no encontrada' });
    }
  } catch (error) {
    console.error('❌ Error al eliminar auditoría:', error);
    res.status(500).json({ mensaje: '❌ Error al eliminar auditoría', error });
  }
};
