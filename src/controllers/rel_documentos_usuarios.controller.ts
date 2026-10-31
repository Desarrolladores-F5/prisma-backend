// src/controllers/rel_documentos_usuarios.controller.ts
import { Request, Response } from 'express';
import { RelDocumentoUsuario, Usuario, Documento, FirmaDigital } from '../models';
import { confirmarRecepcionDocumental, ErrorRecepcionDocumental } from '../services/recepcionDocumental.service';
import crypto from 'crypto';
import {
  ejecutarAsignacionDocumental,
} from '../services/coordinadorAsignacionesDocumentales.service';
import {
  ErrorAsignacionDocumental,
} from '../services/asignacionDocumental.service';



// 🔒 Descarga autorizada de constancias documentales
export const descargarConstancia = async (req: Request, res: Response): Promise<void> => {
  try {
    const usuario = (req as any).usuario;

    if (!usuario?.id) {
      res.status(401).json({ mensaje: 'Usuario no autenticado.' });
      return;
    }

    const asignacionId = Number(req.params.id);

    if (!Number.isSafeInteger(asignacionId) || asignacionId <= 0) {
      res.status(400).json({ mensaje: 'Identificador inválido.' });
      return;
    }

    const relacion = await RelDocumentoUsuario.findByPk(asignacionId);

    if (!relacion) {
      res.status(404).json({ mensaje: 'Constancia no encontrada.' });
      return;
    }

    const esPropietario = String(relacion.usuario_id) === String(usuario.id);
    const esAdmin = Number(usuario.rol_id) === 1;

    if (!esPropietario && !esAdmin) {
      res.status(403).json({ mensaje: 'No autorizado para descargar esta constancia.' });
      return;
    }

    if (!relacion.recepcionado || !relacion.ruta_constancia_pdf) {
      res.status(404).json({ mensaje: 'Constancia no disponible.' });
      return;
    }

    const path = await import('path');
    const fs = await import('fs');

    const directorio = path.resolve(__dirname, '../../uploads/confirmaciones');
    const rutaRegistrada = relacion.ruta_constancia_pdf;

    if (
      typeof rutaRegistrada !== 'string' ||
      !rutaRegistrada.startsWith('/uploads/confirmaciones/')
    ) {
      res.status(400).json({ mensaje: 'Ruta de constancia inválida.' });
      return;
    }

    const nombreArchivo = rutaRegistrada.slice('/uploads/confirmaciones/'.length);

    if (
      !/^[a-zA-Z0-9_-]+\.pdf$/.test(nombreArchivo)
    ) {
      res.status(400).json({ mensaje: 'Nombre de constancia inválido.' });
      return;
    }

    const archivoPDF = path.join(directorio, nombreArchivo);

    let datosArchivo;
    try {
      datosArchivo = await fs.promises.lstat(archivoPDF);
    } catch {
      res.status(404).json({ mensaje: 'Archivo PDF no encontrado.' });
      return;
    }

    if (!datosArchivo.isFile() || datosArchivo.isSymbolicLink()) {
      res.status(404).json({ mensaje: 'Archivo PDF no disponible.' });
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(archivoPDF, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
      },
    }, (error) => {
      if (error && !res.headersSent) {
        res.status(500).json({ mensaje: 'No fue posible entregar la constancia.' });
      }
    });
  } catch (error) {
    console.error('Error al descargar constancia:', error);
    res.status(500).json({ mensaje: 'Error al descargar constancia.' });
  }
};

// ✅ Asignar documentos de forma segura y notificar a los destinatarios
export const asignarDocumentoAUsuario = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const administradorId = Number((req as any).usuario?.id);
    const { documento_id, asignacion_tipo, rol_id, usuario_ids } = req.body;

    const documentoId = Number(documento_id);

    if (
      !Number.isSafeInteger(administradorId) ||
      administradorId <= 0
    ) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    if (
      !Number.isSafeInteger(documentoId) ||
      documentoId <= 0
    ) {
      res.status(400).json({ mensaje: 'Documento inválido.' });
      return;
    }

    const documento = await Documento.findByPk(documentoId);

    if (!documento) {
      res.status(404).json({ mensaje: 'Documento no encontrado.' });
      return;
    }

    const nuevas = await ejecutarAsignacionDocumental({
      administradorId,
      documentoId,
      nombreDocumento: documento.nombre,
      asignacionTipo: asignacion_tipo,
      usuarioIds: usuario_ids,
      rolId: rol_id,
    });

    res.status(nuevas.length > 0 ? 201 : 200).json({
      mensaje:
        nuevas.length > 0
          ? 'Documento asignado correctamente.'
          : 'El documento ya estaba asignado a los destinatarios.',
      asignaciones_nuevas: nuevas.length,
    });
  } catch (error) {
    if (error instanceof ErrorAsignacionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('Error al asignar documentos:', error);

    res.status(500).json({
      mensaje: 'No fue posible completar la asignación documental.',
    });
  }
};

// ✅ Obtener documentos asignados por usuario
export const obtenerDocumentosPorUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { usuario_id } = req.params;
    const usuarioAutenticadoId = (req as any).usuario?.id;

    if (!usuarioAutenticadoId) {
      res.status(401).json({ mensaje: 'Usuario no autenticado.' });
      return;
    }

    if (String(usuarioAutenticadoId) !== String(usuario_id)) {
      res.status(403).json({
        mensaje: 'No tienes autorización para consultar documentos de otro usuario.',
      });
      return;
    }

    const asignaciones = await RelDocumentoUsuario.findAll({
      where: { usuario_id: usuarioAutenticadoId },
      include: [{ model: Documento, as: 'documento' }],
    });

    const documentos = asignaciones.map((asignacion) => {
      const doc = asignacion.documento?.toJSON?.() || asignacion.documento;
      return {
        ...doc,
        fecha_asignacion: asignacion.fecha_asignacion,
        recepcionado: asignacion.recepcionado,
        fecha_recepcion: asignacion.fecha_recepcion,
        ruta_constancia_pdf: asignacion.ruta_constancia_pdf,
        // 🔥 campo "activo" eliminado: no lo exponemos desde la relación
      };
    });

    res.status(200).json(documentos);
  } catch (error) {
    console.error('❌ Error al obtener documentos por usuario:', error);
    res.status(500).json({ mensaje: '❌ Error al obtener documentos', error });
  }
};

// ✅ Eliminar asignación
export const eliminarAsignacionDocumentoUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const eliminado = await RelDocumentoUsuario.destroy({ where: { id } });

    if (eliminado) {
      res.status(200).json({ mensaje: '✅ Asignación eliminada correctamente.' });
    } else {
      res.status(404).json({ mensaje: 'Asignación no encontrada.' });
    }
  } catch (error) {
    console.error('❌ Error al eliminar asignación:', error);
    res.status(500).json({ mensaje: '❌ Error al eliminar asignación', error });
  }
};

// ✅ Confirmaciones por documento
export const obtenerConfirmacionesPorDocumento = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const confirmaciones = await RelDocumentoUsuario.findAll({
      where: { documento_id: id },
      include: [
        { model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'apellido', 'correo'] },
        { model: Documento, as: 'documento', attributes: ['id', 'nombre', 'tipo'] },
      ],
    });

    const resultados = confirmaciones.map((rel) => ({
      id: rel.id,
      usuario_id: rel.usuario?.id,
      nombre_usuario: `${rel.usuario?.nombre} ${rel.usuario?.apellido}`,
      correo_usuario: rel.usuario?.correo,
      documento_id: rel.documento?.id,
      nombre_documento: rel.documento?.nombre,
      tipo_documento: rel.documento?.tipo || '',
      fecha_recepcion: rel.fecha_recepcion,
      confirmado: rel.recepcionado === true,
      ruta_constancia_pdf: rel.ruta_constancia_pdf ?? null,
    }));

    res.status(200).json(resultados);
  } catch (error) {
    console.error('❌ Error al obtener confirmaciones del documento:', error);
    res.status(500).json({ mensaje: '❌ Error al obtener confirmaciones del documento', error });
  }
};

// ✅ Confirmar recepción, generar PDF y registrar firma digital
export const confirmarRecepcion = async (req: Request, res: Response): Promise<void> => {
  const usuarioId = Number((req as any).usuario?.id);
  const documentoId = Number(req.params.documento_id);

  if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
    res.status(401).json({ mensaje: 'Usuario no autenticado' });
    return;
  }

  if (!Number.isSafeInteger(documentoId) || documentoId <= 0) {
    res.status(400).json({ mensaje: 'Documento inválido' });
    return;
  }

  if (req.body?.acepta_declaracion !== true) {
    res.status(400).json({
      mensaje: 'Debes aceptar expresamente la declaración de lectura y comprensión antes de confirmar la recepción.',
    });
    return;
  }

  try {
    const resultado = await confirmarRecepcionDocumental({
      documentoId,
      usuarioId,
      aceptaDeclaracion: true,
    });

    res.status(200).json({
      mensaje: '✅ Recepción confirmada, constancia generada y firma registrada.',
      ruta_constancia_pdf: resultado.ruta_constancia_pdf,
      constancia_url: resultado.ruta_constancia_pdf,
    });
  } catch (error) {
    if (error instanceof ErrorRecepcionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('❌ Error al confirmar recepción:', error);
    res.status(500).json({ mensaje: 'Error al confirmar recepción' });
  }
};
