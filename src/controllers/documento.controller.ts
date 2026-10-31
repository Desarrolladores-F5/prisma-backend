// src/controllers/documento.controller.ts
import { Request, Response } from 'express';
import { Documento, RelDocumentoUsuario, Usuario } from '../models';
import { confirmarRecepcionDocumental, ErrorRecepcionDocumental } from '../services/recepcionDocumental.service';

/** Normaliza y valida que la URL pertenezca a /uploads/... */
function normalizeUploadPath(raw?: string): string | undefined {
  if (raw == null) return undefined;
  // Si viene absoluta, extraemos el pathname
  try {
    const u = new URL(raw);
    const pathname = u.pathname || '';
    if (!pathname.startsWith('/uploads/')) {
      throw new Error('La URL debe comenzar con /uploads/');
    }
    return pathname;
  } catch {
    // No era URL absoluta => validar relativa
    if (!raw.startsWith('/uploads/')) {
      throw new Error('La URL debe comenzar con /uploads/');
    }
    return raw;
  }
}

/** Obtener todos los documentos */
export const obtenerDocumentos = async (_req: Request, res: Response): Promise<void> => {
  try {
    const documentos = await Documento.findAll();
    res.json(documentos);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener documentos', error });
  }
};

/** Crear documento y asignarlo según criterio */
export const crearDocumento = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      nombre,
      tipo,
      url,
      version,
      asignacion_tipo,
      usuario_ids = [],
      rol_id,
    } = req.body;

    const creador_id = (req as any).usuario?.id;
    if (!creador_id) {
      res.status(401).json({ mensaje: '❌ Usuario no autenticado' });
      return;
    }

    if (!nombre || !tipo || !url || !version || !asignacion_tipo) {
      res.status(400).json({ mensaje: '❌ Faltan campos requeridos' });
      return;
    }

    const urlNormalizada = normalizeUploadPath(url);

    const nuevoDocumento = await Documento.create({
      nombre,
      tipo,
      url: urlNormalizada!,
      version,
    });

    // Asignaciones
    let usuariosAsignados: number[] = [];
    switch (asignacion_tipo) {
      case 'todos': {
        const usuarios = await Usuario.findAll({ where: { /* si tienes 'activo' en usuarios, puedes filtrar aquí */ } });
        usuariosAsignados = usuarios.map(u => u.id);
        break;
      }
      case 'rol': {
        if (!rol_id) {
          res.status(400).json({ mensaje: '❌ Falta rol_id' });
          return;
        }
        const usuarios = await Usuario.findAll({ where: { rol_id } });
        usuariosAsignados = usuarios.map(u => u.id);
        break;
      }
      case 'usuarios': {
        if (!Array.isArray(usuario_ids)) {
          res.status(400).json({ mensaje: '❌ usuario_ids debe ser un arreglo' });
          return;
        }
        usuariosAsignados = usuario_ids;
        break;
      }
      default:
        res.status(400).json({ mensaje: '❌ Tipo de asignación inválido' });
        return;
    }

    if (usuariosAsignados.length > 0) {
      await RelDocumentoUsuario.bulkCreate(
        usuariosAsignados.map(usuario_id => ({
          documento_id: nuevoDocumento.id,
          usuario_id,
          fecha_asignacion: new Date(),
        }))
      );
    }

    res.status(201).json({
      mensaje: '✅ Documento creado y asignado correctamente',
      documento: nuevoDocumento,
    });
  } catch (error: any) {
    console.error('❌ Error al crear documento:', error);
    res.status(500).json({ mensaje: `❌ ${error?.message || 'Error al crear documento'}`, error });
  }
};

/** Actualización parcial del documento (sin campo 'activo') */
export const actualizarDocumento = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const documento = await Documento.findByPk(id);

    if (!documento) {
      res.status(404).json({ mensaje: '❌ Documento no encontrado' });
      return;
    }

    const {
      nombre,
      tipo,
      url,
      version,
    }: { nombre?: string; tipo?: string; url?: string; version?: string } = req.body;

    const data: any = {};
    if (nombre !== undefined) data.nombre = nombre;
    if (tipo !== undefined) data.tipo = tipo;
    if (version !== undefined) data.version = version;
    if (url !== undefined) data.url = normalizeUploadPath(url);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ mensaje: '❌ No se enviaron campos para actualizar' });
      return;
    }

    await documento.update(data);
    res.json({ mensaje: '✅ Documento actualizado correctamente', id: documento.id });
  } catch (error: any) {
    console.error('❌ Error al actualizar documento:', error);
    res.status(400).json({ mensaje: `❌ ${error?.message || 'Error al actualizar documento'}` });
  }
};

/** Eliminar documento (hard delete) */
export const eliminarDocumento = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const rows = await Documento.destroy({ where: { id } });

    if (rows > 0) {
      res.json({ mensaje: '✅ Documento eliminado' });
    } else {
      res.status(404).json({ mensaje: '❌ Documento no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al eliminar documento', error });
  }
};

/** Documentos asignados al usuario autenticado */
export const obtenerMisDocumentos = async (req: Request, res: Response): Promise<void> => {
  try {
    const usuario = (req as any).usuario;
    if (!usuario?.id) {
      res.status(401).json({ mensaje: '❌ Usuario no autenticado' });
      return;
    }

    const documentos = await Documento.findAll({
      include: [
        {
          association: 'asignaciones',
          where: { usuario_id: usuario.id }, // 🔸 sin condición de 'activo'
          required: true,
          attributes: ['id', 'fecha_asignacion', 'recepcionado', 'fecha_recepcion', 'ruta_constancia_pdf'],
        },
      ],
    });

    res.json(
      documentos.map((doc: any) => {
        const a = doc.asignaciones[0];
        return {
          id: doc.id,
          asignacion_id: a?.id ?? null,
          nombre: doc.nombre,
          tipo: doc.tipo,
          url: doc.url,
          version: doc.version,
          fecha_creacion: doc.fecha_creacion,
          recepcionado: a?.recepcionado ?? false,
          fecha_recepcion: a?.fecha_recepcion ?? null,
          fecha_asignacion: a?.fecha_asignacion ?? null,
          ruta_constancia_pdf: a?.ruta_constancia_pdf ?? null,
        };
      })
    );
  } catch (error) {
    console.error('❌ Error al obtener documentos del usuario:', error);
    res.status(500).json({ mensaje: '❌ Error al obtener documentos del usuario', error });
  }
};

/** Obtener un documento por ID */
export const obtenerDocumentoPorId = async (req: Request, res: Response): Promise<void> => {
  try {
    const documento = await Documento.findByPk(req.params.id);
    if (documento) {
      res.json(documento);
    } else {
      res.status(404).json({ mensaje: '❌ Documento no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener documento por ID', error });
  }
};

/** Confirmar recepción de documento y generar constancia PDF */
export const confirmarRecepcionDocumento = async (req: Request, res: Response): Promise<void> => {
  const usuarioId = Number((req as any).usuario?.id);
  const documentoId = Number(req.params.documentoId);

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
      mensaje: '✅ Documento recepcionado y constancia generada',
      constancia_url: resultado.ruta_constancia_pdf,
      ruta_constancia_pdf: resultado.ruta_constancia_pdf,
    });
  } catch (error) {
    if (error instanceof ErrorRecepcionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('❌ Error al confirmar recepción:', error);
    res.status(500).json({ mensaje: 'Error al confirmar recepción del documento' });
  }
};

/** Confirmaciones por documento */
export const obtenerConfirmacionesDocumento = async (req: Request, res: Response): Promise<void> => {
  try {
    const confirmaciones = await RelDocumentoUsuario.findAll({
      where: { documento_id: req.params.id, recepcionado: true },
      include: [
        { model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'apellido', 'correo'] },
        { model: Documento, as: 'documento', attributes: ['id', 'nombre', 'tipo'] },
      ],
    });

    const datos = confirmaciones
      .map((relacion) => {
        if (!relacion.usuario || !relacion.documento) return null;
        return {
          id: relacion.id,
          usuario_id: relacion.usuario.id,
          nombre_usuario: `${relacion.usuario.nombre} ${relacion.usuario.apellido}`,
          correo_usuario: relacion.usuario.correo,
          documento_id: relacion.documento.id,
          nombre_documento: relacion.documento.nombre,
          tipo_documento: relacion.documento.tipo,
          fecha_recepcion: relacion.fecha_recepcion,
          constancia_pdf: relacion.ruta_constancia_pdf ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    res.status(200).json(datos);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener confirmaciones', error });
  }
};
