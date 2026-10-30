import crypto from 'crypto';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { sequelize, RelDocumentoUsuario, FirmaDigital, Documento, Usuario } from '../models';
import { generarPDFConfirmacion } from '../utils/pdf';

interface SolicitudRecepcionDocumental {
  documentoId: number;
  usuarioId: number;
  aceptaDeclaracion: boolean;
}

export class ErrorRecepcionDocumental extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorRecepcionDocumental';
  }
}

export const confirmarRecepcionDocumental = async ({
  documentoId,
  usuarioId,
  aceptaDeclaracion,
}: SolicitudRecepcionDocumental): Promise<{ ruta_constancia_pdf: string }> => {
  if (aceptaDeclaracion !== true) {
    throw new ErrorRecepcionDocumental(
      400,
      'Debes aceptar expresamente la declaración de lectura y comprensión.'
    );
  }

  if (
    !Number.isSafeInteger(documentoId) ||
    documentoId <= 0 ||
    !Number.isSafeInteger(usuarioId) ||
    usuarioId <= 0
  ) {
    throw new ErrorRecepcionDocumental(400, 'Datos de recepción inválidos.');
  }

  const transaccion = await sequelize.transaction();
  let rutaPDFGenerado: string | null = null;
  let commitIniciado = false;

  try {
    const relacion = await RelDocumentoUsuario.findOne({
      where: {
        documento_id: documentoId,
        usuario_id: usuarioId,
      },
      include: [
        { model: Documento, as: 'documento' },
        { model: Usuario, as: 'usuario' },
      ],
      transaction: transaccion,
      lock: transaccion.LOCK.UPDATE,
    });

    if (!relacion || !relacion.documento || !relacion.usuario) {
      throw new ErrorRecepcionDocumental(404, 'Asignación documental no encontrada.');
    }

    if (relacion.recepcionado) {
      throw new ErrorRecepcionDocumental(409, 'El documento ya fue recepcionado.');
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
        rut: relacion.usuario.rut || undefined,
        firma_imagen_url: relacion.usuario.firma_imagen_url || undefined,
      },
      fecha,
      documentoId,
      usuarioId,
    });

    rutaPDFGenerado = rutaPDF;

    relacion.recepcionado = true;
    relacion.fecha_recepcion = fecha;
    relacion.ruta_constancia_pdf = rutaPDF;

    await relacion.save({ transaction: transaccion });

    const hashFirma = crypto
      .createHash('sha256')
      .update(`${documentoId}-${usuarioId}-${fecha.toISOString()}`)
      .digest('hex');

    await FirmaDigital.create(
      {
        firmante_id: usuarioId,
        documento_id: documentoId,
        hash_firma: hashFirma,
        tipo_firma: 'firma_documento',
        fecha,
        metadata: {
          entidad: 'documento',
          entidad_id: documentoId,
          relacion_id: relacion.id,
          acepta_declaracion: true,
          fecha_aceptacion: fecha.toISOString(),
          ruta_constancia_pdf: rutaPDF,
        },
      },
      { transaction: transaccion }
    );

    commitIniciado = true;
    await transaccion.commit();

    return { ruta_constancia_pdf: rutaPDF };
  } catch (error) {
    if (!commitIniciado) {
      try {
        await transaccion.rollback();
      } catch (errorRollback) {
        console.error('Error al revertir la recepción documental:', errorRollback);
      }

      if (rutaPDFGenerado) {
        const carpeta = path.resolve(__dirname, '../../uploads/confirmaciones');
        const nombre = rutaPDFGenerado.slice('/uploads/confirmaciones/'.length);

        const rutaValida =
          rutaPDFGenerado.startsWith('/uploads/confirmaciones/') &&
          /^confirmacion_doc_[1-9]\d*_usuario_[1-9]\d*_\d+(?:_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\.pdf$/.test(nombre) &&
          nombre === path.basename(nombre) &&
          nombre.startsWith(`confirmacion_doc_${documentoId}_usuario_${usuarioId}_`);

        if (rutaValida) {
          try {
            await fs.unlink(path.join(carpeta, nombre));
          } catch (errorLimpieza) {
            console.error('No se pudo limpiar el PDF de la recepción fallida:', errorLimpieza);
          }
        }
      }
    }

    throw error;
  }
};
