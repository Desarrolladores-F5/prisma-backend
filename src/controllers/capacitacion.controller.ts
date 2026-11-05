import { avisarResultadoExamen } from '../services/notificacionesAutomaticas.service';
import { avisarCapacitacion } from '../services/notificacionesAutomaticas.service';
// src/controllers/capacitacion.controller.ts
import { Request, Response } from 'express';
import {
  Capacitacion,
  Usuario,
  Faena,
  Documento,
  Examen,
  PreguntaExamen,
  RespuestaExamen
} from '../models';

// ✅ Obtener todas las capacitaciones (Admin y Supervisor)
export const obtenerCapacitaciones = async (_req: Request, res: Response): Promise<void> => {
  try {
    const capacitaciones = await Capacitacion.findAll({
      where: { activo: true },
      include: [
        { model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'apellido'] },
        { model: Faena, as: 'faena', attributes: ['id', 'nombre'] },
        { model: Documento, as: 'documento', attributes: ['id', 'nombre', 'url'] },
        { model: Examen, as: 'examen', attributes: ['id', 'titulo', 'descripcion'] },
      ]
    });
    res.json(capacitaciones);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener capacitaciones', error });
  }
};

// ✅ Crear capacitación
export const crearCapacitacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const nueva = await Capacitacion.create(req.body);

    // Notificar sin impedir el registro de la capacitación.
    try {
      await avisarCapacitacion({
        capacitacionId: nueva.id,
        titulo: nueva.titulo,
        faenaId: Number(nueva.faena_id),
        capacitadorId: Number(nueva.usuario_id),
      });
    } catch (errorNotificacion) {
      console.error(
        'Capacitación creada, pero no fue posible generar las notificaciones:',
        errorNotificacion
      );
    }

    res.status(201).json(nueva);
  } catch (error) {
    console.error('Error al crear capacitación:', error);
    res.status(400).json({ mensaje: '❌ Error al crear capacitación' });
  }
};

// ✅ Actualizar capacitación
export const actualizarCapacitacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [actualizada] = await Capacitacion.update(req.body, { where: { id } });

    if (actualizada) {
      const actual = await Capacitacion.findByPk(id);
      res.json(actual);
    } else {
      res.status(404).json({ mensaje: 'Capacitación no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al actualizar capacitación', error });
  }
};

// ✅ Eliminar capacitación (soft delete)
export const eliminarCapacitacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [resultado] = await Capacitacion.update({ activo: false }, { where: { id } });

    if (resultado) {
      res.json({ mensaje: '✅ Capacitación eliminada correctamente (soft delete)' });
    } else {
      res.status(404).json({ mensaje: 'Capacitación no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al eliminar capacitación', error });
  }
};

// ✅ Obtener capacitaciones disponibles para el trabajador (con resultado del examen si existe)
export const obtenerCapacitacionesDisponibles = async (req: Request, res: Response): Promise<void> => {
  const usuarioId = (req as any).usuario?.id;

  try {
    const capacitaciones = await Capacitacion.findAll({
      where: { activo: true },
      include: [
        { model: Faena, as: 'faena', attributes: ['id', 'nombre'] },
        { model: Documento, as: 'documento', attributes: ['id', 'nombre', 'url'] },
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['id', 'nombre', 'apellido']
        },
        {
          model: Examen,
          as: 'examen',
          attributes: ['id', 'titulo'],
          include: [
            {
              model: RespuestaExamen,
              as: 'respuestas',
              where: { usuario_id: usuarioId },
              required: false,
              attributes: ['id', 'fecha_respuesta', 'porcentaje_aprobacion', 'aprobado']
            }
          ]
        }
      ]
    });

    res.json(capacitaciones);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener capacitaciones disponibles', error });
  }
};

// ✅ Obtener preguntas del examen por ID de capacitación
export const obtenerPreguntasPorCapacitacionId = async (req: Request, res: Response): Promise<void> => {
  const { id: capacitacionId } = req.params;

  try {
    const examen = await Examen.findOne({ where: { capacitacion_id: capacitacionId } });

    if (!examen) {
      res.status(404).json({ mensaje: '❌ No se encontró examen para esta capacitación.' });
      return;
    }

    const preguntas = await PreguntaExamen.findAll({
      where: { examen_id: examen.id },
      attributes: ['id', 'enunciado', 'alternativas']
    });

    res.json(preguntas);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener preguntas del examen', error });
  }
};

// ✅ Responder examen con resultado y actualización en bloque
export const responderExamenPorCapacitacionId = async (req: Request, res: Response): Promise<void> => {
  const { id: capacitacionId } = req.params;
  const usuarioId = (req as any).usuario?.id;
  const { respuestas } = req.body;

  if (!usuarioId || !respuestas || typeof respuestas !== 'object') {
    res.status(400).json({ mensaje: '❌ Datos inválidos para enviar respuestas.' });
    return;
  }

  try {
    const examen = await Examen.findOne({ where: { capacitacion_id: capacitacionId } });
    if (!examen) {
      res.status(404).json({ mensaje: '❌ No se encontró examen para esta capacitación.' });
      return;
    }

    const yaRespondido = await RespuestaExamen.findOne({
      where: { usuario_id: usuarioId, examen_id: examen.id }
    });

    if (yaRespondido) {
      res.status(400).json({ mensaje: '❌ Ya has respondido este examen. Solo se permite un intento.' });
      return;
    }

    const preguntas = await PreguntaExamen.findAll({ where: { examen_id: examen.id } });
    if (preguntas.length === 0) {
      res.status(400).json({ mensaje: '❌ No hay preguntas para este examen.' });
      return;
    }

    const respuestasCreadas = [];
    let correctas = 0;

    for (const pregunta of preguntas) {
      const respuestaSeleccionada = respuestas[pregunta.id];
      if (!respuestaSeleccionada) continue;

      const esCorrecta = pregunta.respuesta_correcta === respuestaSeleccionada;

      const nueva = await RespuestaExamen.create({
        usuario_id: usuarioId,
        examen_id: examen.id,
        pregunta_id: pregunta.id,
        respuesta_entregada: respuestaSeleccionada,
        correcta: esCorrecta,
      });

      if (esCorrecta) correctas++;
      respuestasCreadas.push(nueva);
    }

    const total = respuestasCreadas.length;
    const porcentaje = total > 0 ? Math.round((correctas / total) * 100) : 0;
    const aprobado = porcentaje >= 75;
    const fecha = respuestasCreadas[0]?.fecha_respuesta ?? new Date();

    // ✅ ACTUALIZAR TODAS LAS RESPUESTAS DEL USUARIO PARA ESTE EXAMEN CON EL RESULTADO
    await RespuestaExamen.update(
      {
        porcentaje_aprobacion: porcentaje,
        aprobado: aprobado
      },
      {
        where: {
          usuario_id: usuarioId,
          examen_id: examen.id
        }
      }
    );

    // Notificar únicamente después de guardar el resultado.
    // Un fallo del aviso no invalida el examen registrado.
    try {
      await avisarResultadoExamen({
        examenId: Number(examen.id),
        trabajadorId: Number(usuarioId),
        porcentaje,
        aprobado,
      });
    } catch (errorNotificacion) {
      console.error(
        'Examen registrado, pero falló la notificación:',
        errorNotificacion
      );
    }

    res.status(201).json({
      mensaje: '✅ Examen registrado correctamente.',
      fecha_respuesta: fecha,
      porcentaje_aprobacion: porcentaje,
      aprobado
    });

  } catch (error) {
    console.error('❌ Error en responderExamenPorCapacitacionId:', error);
    res.status(500).json({ mensaje: '❌ Error al registrar respuestas del examen', error });
  }
};

// ✅ Obtener resultado del examen con detalles de capacitación y examen
export const obtenerResultadoExamen = async (req: Request, res: Response): Promise<void> => {
  const usuarioId = (req as any).usuario?.id;
  const capacitacionId = Number(req.params.id);

  if (!usuarioId || isNaN(capacitacionId)) {
    res.status(400).json({ mensaje: '❌ Parámetros inválidos' });
    return;
  }

  try {
    const examen = await Examen.findOne({
      where: { capacitacion_id: capacitacionId },
      include: [
        {
          association: 'capacitacion',
          attributes: ['id', 'titulo', 'descripcion']
        }
      ]
    });

    if (!examen) {
      res.status(404).json({ mensaje: '❌ No se encontró examen para esta capacitación.' });
      return;
    }

    const respuestas = await RespuestaExamen.findAll({
      where: {
        usuario_id: usuarioId,
        examen_id: examen.id
      }
    });

    if (respuestas.length === 0) {
      res.status(404).json({ mensaje: '❌ Aún no has respondido este examen.' });
      return;
    }

    const total = respuestas.length;
    const correctas = respuestas.filter(r => r.correcta).length;
    const porcentaje = Math.round((correctas / total) * 100);
    const fecha = respuestas[0].fecha_respuesta;

    res.json({
      fecha_respuesta: fecha,
      total_preguntas: total,
      respuestas_correctas: correctas,
      porcentaje_aprobacion: porcentaje,
      aprobado: porcentaje >= 75,
      resultado: porcentaje >= 75 ? '✅ Aprobado' : '❌ Reprobado',
      examen: {
        id: examen.id,
        titulo: examen.titulo
      },
      capacitacion: examen.capacitacion || null
    });

  } catch (error) {
    console.error('❌ Error al obtener resultado del examen:', error);
    res.status(500).json({ mensaje: '❌ Error interno al obtener resultado del examen', error });
  }
};

// ✅ Obtener resumen de respuestas por capacitación (uso administrativo)
export const obtenerRespuestasDeCapacitacion = async (req: Request, res: Response): Promise<void> => {
  const capacitacionId = Number(req.params.id);

  if (isNaN(capacitacionId)) {
    res.status(400).json({ mensaje: '❌ ID de capacitación inválido' });
    return;
  }

  try {
    const examen = await Examen.findOne({ where: { capacitacion_id: capacitacionId } });

    if (!examen) {
      res.status(404).json({ mensaje: '❌ No se encontró examen para esta capacitación' });
      return;
    }

    const respuestas = await RespuestaExamen.findAll({
      where: { examen_id: examen.id },
      include: [
        {
          association: 'usuario',
          attributes: ['id', 'nombre', 'apellido', 'rut', 'faena_id']
        }
      ],
      order: [['usuario_id', 'ASC'], ['fecha_respuesta', 'DESC']]
    });

    const resumenMap = new Map<number, any>();

  for (const r of respuestas) {
    if (!resumenMap.has(r.usuario_id)) {
    const usuario = r.get('usuario') as any;

    resumenMap.set(r.usuario_id, {
      usuario_id: r.usuario_id,
      nombre: usuario?.nombre,
      apellido: usuario?.apellido,
      rut: usuario?.rut,
      faena_id: usuario?.faena_id,
      fecha_respuesta: r.fecha_respuesta,
      porcentaje_aprobacion: r.porcentaje_aprobacion,
      aprobado: r.aprobado,
    });
  }
}


    res.json(Array.from(resumenMap.values()));
  } catch (error) {
    console.error('❌ Error al obtener respuestas de capacitación:', error);
    res.status(500).json({ mensaje: '❌ Error interno al obtener respuestas', error });
  }
};
