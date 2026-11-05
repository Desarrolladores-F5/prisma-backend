// src/controllers/documento.controller.ts
import { Request, Response } from 'express';
import {
  crearDocumentoConAsignaciones,
} from '../services/creacionDocumental.service';
import {
  ErrorAsignacionDocumental,
  obtenerEmpresaAdministrador,
} from '../services/asignacionDocumental.service';

import { Documento, RelDocumentoUsuario, Usuario } from '../models';
import {
  confirmarRecepcionDocumental,
  ErrorRecepcionDocumental,
} from '../services/recepcionDocumental.service';

/** Normaliza y valida que la URL pertenezca a /uploads/... */
function normalizeUploadPath(raw?: string): string | undefined {
  if (raw == null) return undefined;

  try {
    const u = new URL(raw);
    const pathname = u.pathname || '';

    if (!pathname.startsWith('/uploads/')) {
      throw new Error('La URL debe comenzar con /uploads/');
    }

    return pathname;
  } catch {
    if (!raw.startsWith('/uploads/')) {
      throw new Error('La URL debe comenzar con /uploads/');
    }

    return raw;
  }
}

/** Obtener documentos de la empresa del administrador autenticado */
export const obtenerDocumentos = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const administradorId = Number((req as any).usuario?.id);

    if (!Number.isSafeInteger(administradorId) || administradorId <= 0) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    const empresaId = await obtenerEmpresaAdministrador(administradorId);

    const documentos = await Documento.findAll({
      where: { empresa_id: empresaId },
    });

    res.json(documentos);
  } catch (error) {
    if (error instanceof ErrorAsignacionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('Error al obtener documentos:', error);

    res.status(500).json({
      mensaje: 'No fue posible obtener los documentos.',
    });
  }
};

/** Crear documento, opcionalmente con asignación transaccional */
export const crearDocumento = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const administradorId = Number((req as any).usuario?.id);

    if (!Number.isSafeInteger(administradorId) || administradorId <= 0) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    const {
      nombre,
      tipo,
      url,
      version,
      asignacion_tipo,
      usuario_ids,
      rol_id,
    } = req.body ?? {};

    if (
      typeof nombre !== 'string' ||
      typeof tipo !== 'string' ||
      typeof url !== 'string' ||
      typeof version !== 'string' ||
      !nombre.trim() ||
      !tipo.trim() ||
      !url.trim() ||
      !version.trim()
    ) {
      res.status(400).json({
        mensaje: 'Faltan datos obligatorios del documento.',
      });
      return;
    }

    let urlNormalizada: string | undefined;

    try {
      urlNormalizada = normalizeUploadPath(url);
    } catch {
      res.status(400).json({
        mensaje: 'URL del documento inválida.',
      });
      return;
    }

    if (!urlNormalizada) {
      res.status(400).json({
        mensaje: 'URL del documento inválida.',
      });
      return;
    }

    const datosDocumento = {
      nombre: nombre.trim(),
      tipo: tipo.trim(),
      url: urlNormalizada,
      version: version.trim(),
    };

    const hayAsignacion =
      asignacion_tipo !== undefined &&
      asignacion_tipo !== null;

    if (
      !hayAsignacion &&
      (usuario_ids !== undefined || rol_id !== undefined)
    ) {
      res.status(400).json({
        mensaje: 'Debe indicar el tipo de asignación.',
      });
      return;
    }

    const documento = hayAsignacion
      ? await crearDocumentoConAsignaciones({
          administradorId,
          ...datosDocumento,
          asignacionTipo: asignacion_tipo,
          usuarioIds: usuario_ids,
          rolId: rol_id,
        })
      : await Documento.create({
          ...datosDocumento,
          empresa_id: await obtenerEmpresaAdministrador(administradorId),
        });

    res.status(201).json({
      mensaje: hayAsignacion
        ? 'Documento creado y asignado correctamente.'
        : 'Documento creado correctamente.',
      id: documento.id,
      documento,
    });
  } catch (error) {
    if (error instanceof ErrorAsignacionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('Error al crear documento:', error);

    res.status(500).json({
      mensaje: 'No fue posible crear el documento.',
    });
  }
};

/** Actualización parcial del documento, limitada a la empresa */
export const actualizarDocumento = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const administradorId = Number((req as any).usuario?.id);

    if (!Number.isSafeInteger(administradorId) || administradorId <= 0) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    const empresaId = await obtenerEmpresaAdministrador(administradorId);
    const { id } = req.params;

    const documento = await Documento.findOne({
      where: {
        id,
        empresa_id: empresaId,
      },
    });

    if (!documento) {
      res.status(404).json({
        mensaje: '❌ Documento no encontrado',
      });
      return;
    }

    const {
      nombre,
      tipo,
      url,
      version,
    }: {
      nombre?: string;
      tipo?: string;
      url?: string;
      version?: string;
    } = req.body;

    const data: any = {};

    if (nombre !== undefined) data.nombre = nombre;
    if (tipo !== undefined) data.tipo = tipo;
    if (version !== undefined) data.version = version;
    if (url !== undefined) data.url = normalizeUploadPath(url);

    if (Object.keys(data).length === 0) {
      res.status(400).json({
        mensaje: '❌ No se enviaron campos para actualizar',
      });
      return;
    }

    await documento.update(data);

    res.json({
      mensaje: '✅ Documento actualizado correctamente',
      id: documento.id,
    });
  } catch (error) {
    if (error instanceof ErrorAsignacionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('❌ Error al actualizar documento:', error);

    res.status(400).json({
      mensaje: `❌ ${
        error instanceof Error ? error.message : 'Error al actualizar documento'
      }`,
    });
  }
};

/** Eliminar documento, limitado a la empresa */
export const eliminarDocumento = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const administradorId = Number((req as any).usuario?.id);

    if (!Number.isSafeInteger(administradorId) || administradorId <= 0) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    const empresaId = await obtenerEmpresaAdministrador(administradorId);

    const rows = await Documento.destroy({
      where: {
        id: req.params.id,
        empresa_id: empresaId,
      },
    });

    if (rows > 0) {
      res.json({ mensaje: '✅ Documento eliminado' });
    } else {
      res.status(404).json({
        mensaje: '❌ Documento no encontrado',
      });
    }
  } catch (error) {
    if (error instanceof ErrorAsignacionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('Error al eliminar documento:', error);

    res.status(500).json({
      mensaje: '❌ Error al eliminar documento',
    });
  }
};

/** Documentos asignados al usuario autenticado */
export const obtenerMisDocumentos = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const usuario = (req as any).usuario;

    if (!usuario?.id) {
      res.status(401).json({
        mensaje: '❌ Usuario no autenticado',
      });
      return;
    }

    const documentos = await Documento.findAll({
      include: [
        {
          association: 'asignaciones',
          where: { usuario_id: usuario.id },
          required: true,
          attributes: [
            'id',
            'fecha_asignacion',
            'recepcionado',
            'fecha_recepcion',
            'ruta_constancia_pdf',
          ],
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

    res.status(500).json({
      mensaje: '❌ Error al obtener documentos del usuario',
      error,
    });
  }
};

/** Obtener un documento por ID, limitado a la empresa */
export const obtenerDocumentoPorId = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const administradorId = Number((req as any).usuario?.id);

    if (!Number.isSafeInteger(administradorId) || administradorId <= 0) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    const empresaId = await obtenerEmpresaAdministrador(administradorId);

    const documento = await Documento.findOne({
      where: {
        id: req.params.id,
        empresa_id: empresaId,
      },
    });

    if (documento) {
      res.json(documento);
    } else {
      res.status(404).json({
        mensaje: '❌ Documento no encontrado',
      });
    }
  } catch (error) {
    if (error instanceof ErrorAsignacionDocumental) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('Error al obtener documento por ID:', error);

    res.status(500).json({
      mensaje: '❌ Error al obtener documento por ID',
    });
  }
};

/** Confirmar recepción de documento y generar constancia PDF */
export const confirmarRecepcionDocumento = async (
  req: Request,
  res: Response
): Promise<void> => {
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
      mensaje:
        'Debes aceptar expresamente la declaración de lectura y comprensión antes de confirmar la recepción.',
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

    res.status(500).json({
      mensaje: 'Error al confirmar recepción del documento',
    });
  }
};

/** Confirmaciones por documento */
export const obtenerConfirmacionesDocumento = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const confirmaciones = await RelDocumentoUsuario.findAll({
      where: {
        documento_id: req.params.id,
        recepcionado: true,
      },
      include: [
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['id', 'nombre', 'apellido', 'correo'],
        },
        {
          model: Documento,
          as: 'documento',
          attributes: ['id', 'nombre', 'tipo'],
        },
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
    res.status(500).json({
      mensaje: '❌ Error al obtener confirmaciones',
      error,
    });
  }
};
