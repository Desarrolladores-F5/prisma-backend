// src/controllers/rel_documentos_usuarios.controller.ts
import { Request, Response } from 'express';
import { RelDocumentoUsuario, Usuario, Documento, FirmaDigital } from '../models';
import { generarPDFConfirmacion } from '../utils/pdf';
import crypto from 'crypto';


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

// ✅ Asignar documento (uno o múltiples usuarios)
export const asignarDocumentoAUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { documento_id, asignacion_tipo, rol_id, usuario_ids } = req.body;

    if (!documento_id || !asignacion_tipo) {
      res.status(400).json({ mensaje: 'Faltan parámetros requeridos.' });
      return;
    }

    if (asignacion_tipo === 'todos' || asignacion_tipo === 'rol') {
      if (!rol_id) {
        res.status(400).json({ mensaje: 'Debe especificar un rol para la asignación.' });
        return;
      }

      // Si tu modelo Usuario mantiene "activo", puedes seguir filtrando por ahí.
      const usuarios = await Usuario.findAll({
        where: { activo: true, rol_id },
      });

      if (!usuarios.length) {
        res.status(404).json({ mensaje: 'No se encontraron usuarios activos con ese rol.' });
        return;
      }

      const relaciones = usuarios.map((u) => ({
        documento_id,
        usuario_id: u.id,
        fecha_asignacion: new Date(),
      }));

      await RelDocumentoUsuario.bulkCreate(relaciones, { ignoreDuplicates: true });

      res.status(201).json({ mensaje: `✅ Documento asignado a ${usuarios.length} usuario(s) con rol.` });
    } else if (asignacion_tipo === 'usuarios') {
      if (!usuario_ids || !Array.isArray(usuario_ids) || usuario_ids.length === 0) {
        res.status(400).json({ mensaje: 'Debe especificar al menos un ID de usuario.' });
        return;
      }

      const relaciones = usuario_ids.map((id: number) => ({
        documento_id,
        usuario_id: id,
        fecha_asignacion: new Date(),
      }));

      await RelDocumentoUsuario.bulkCreate(relaciones, { ignoreDuplicates: true });

      res.status(201).json({ mensaje: '✅ Documento asignado a los usuarios seleccionados.' });
    } else {
      res.status(400).json({ mensaje: 'Tipo de asignación no válido.' });
    }
  } catch (error) {
    console.error('❌ Error al asignar documento:', error);
    res.status(500).json({ mensaje: '❌ Error al asignar documento', error });
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
  try {
    const { documento_id } = req.params;
    const usuario_id = (req as any).usuario?.id;

    if (!usuario_id) {
      res.status(401).json({ mensaje: 'Usuario no autenticado' });
      return;
    }

    // La recepción documental requiere aceptación expresa.
    if (req.body?.acepta_declaracion !== true) {
      res.status(400).json({
        mensaje: 'Debes aceptar expresamente la declaración de lectura y comprensión antes de confirmar la recepción.',
      });
      return;
    }

    const relacion = await RelDocumentoUsuario.findOne({
      where: { documento_id, usuario_id },
      include: [
        { model: Documento, as: 'documento' },
        { model: Usuario, as: 'usuario' },
      ],
    });

    if (!relacion || !relacion.documento || !relacion.usuario) {
      res.status(404).json({ mensaje: 'No se encontró la relación con datos completos.' });
      return;
    }

    // Evitar generar constancias y firmas duplicadas.
    if (relacion.recepcionado) {
      res.status(409).json({
        mensaje: 'El documento ya fue confirmado anteriormente.',
      });
      return;
    }

    const fecha = new Date();

    const rutaPDF = await generarPDFConfirmacion({
      documento: {
        nombre: relacion.documento.nombre,
        tipo: relacion.documento.tipo,
        version: relacion.documento.version || undefined,
      },
      usuario: {
        nombre: relacion.usuario.nombre,
        apellido: relacion.usuario.apellido,
        correo: relacion.usuario.correo,
        firma_imagen_url: relacion.usuario.firma_imagen_url || undefined,
      },
      fecha,
      documentoId: parseInt(documento_id),
      usuarioId: usuario_id,
    });

    relacion.recepcionado = true;
    relacion.fecha_recepcion = fecha;
    relacion.ruta_constancia_pdf = rutaPDF;
    await relacion.save();

    // ✅ Firma Digital
    const hashFirma = crypto
      .createHash('sha256')
      .update(`${documento_id}-${usuario_id}-${fecha.toISOString()}`)
      .digest('hex');

    await FirmaDigital.create({
      firmante_id: usuario_id,
      hash_firma: hashFirma,
      tipo_firma: 'firma_documento',
      metadata: {
        entidad: 'documento',
        entidad_id: documento_id,
        relacion_id: relacion.id,
        ruta_constancia_pdf: rutaPDF,
        navegador: req.headers['user-agent'],
        fecha: fecha.toISOString(),
      },
    });

    res.status(200).json({
      mensaje: '✅ Recepción confirmada, constancia generada y firma registrada.',
      ruta_constancia_pdf: rutaPDF,
    });
  } catch (error) {
    console.error('❌ Error al confirmar recepción:', error);
    res.status(500).json({ mensaje: '❌ Error al confirmar recepción', error });
  }
};
