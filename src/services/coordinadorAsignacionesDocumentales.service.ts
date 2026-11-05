import { sequelize, Documento } from '../models';
import {
  resolverDestinatariosDocumento,
  obtenerEmpresaAdministrador,
  ErrorAsignacionDocumental,
} from './asignacionDocumental.service';
import {
  registrarAsignacionesDocumentales,
} from './registroAsignacionesDocumentales.service';
import {
  avisarAsignacionDocumental,
} from './notificacionesAutomaticas.service';

interface SolicitudAsignacionDocumental {
  administradorId: number;
  documentoId: number;
  nombreDocumento: string;
  asignacionTipo: 'usuarios' | 'rol' | 'todos';
  usuarioIds?: number[];
  rolId?: number;
}

export const ejecutarAsignacionDocumental = async ({
  administradorId,
  documentoId,
  nombreDocumento,
  asignacionTipo,
  usuarioIds,
  rolId,
}: SolicitudAsignacionDocumental): Promise<number[]> => {
  if (
    !Number.isSafeInteger(documentoId) ||
    documentoId <= 0
  ) {
    throw new ErrorAsignacionDocumental(
      400,
      'Identificador de documento inválido.'
    );
  }

  // Obtener la empresa real desde el usuario autenticado.
  // Nunca confiar en un empresa_id enviado por el frontend.
  const empresaId = await obtenerEmpresaAdministrador(
    administradorId
  );

  // Comprobar que el documento pertenece a esa empresa.
  // Esta validación ocurre antes de iniciar la transacción.
  const documento = await Documento.findOne({
    where: {
      id: documentoId,
      empresa_id: empresaId,
    },
    attributes: ['id', 'nombre', 'empresa_id'],
  });

  if (!documento) {
    throw new ErrorAsignacionDocumental(
      404,
      'Documento no encontrado en la empresa autorizada.'
    );
  }

  // Validar destinatarios activos de la misma empresa.
  const destinatarios = await resolverDestinatariosDocumento({
    administradorId,
    asignacionTipo,
    usuarioIds,
    rolId,
  });

  const transaccion = await sequelize.transaction();
  let commitIniciado = false;
  let nuevasAsignaciones: number[] = [];

  try {
    nuevasAsignaciones = await registrarAsignacionesDocumentales({
      documentoId,
      destinatariosIds: destinatarios,
      transaccion,
    });

    commitIniciado = true;
    await transaccion.commit();
  } catch (error) {
    if (!commitIniciado) {
      try {
        await transaccion.rollback();
      } catch (errorRollback) {
        console.error(
          'No fue posible revertir la asignación documental:',
          errorRollback
        );
      }
    }

    throw error;
  }

  // Las notificaciones se generan solamente después del commit.
  // No se utiliza el nombre enviado por el cliente: se obtiene
  // directamente del documento autorizado en MySQL.
  if (nuevasAsignaciones.length > 0) {
    try {
      await avisarAsignacionDocumental({
        documentoId,
        nombreDocumento: documento.nombre,
        destinatariosIds: nuevasAsignaciones,
      });
    } catch (errorNotificacion) {
      console.error(
        'Asignación confirmada, pero falló la notificación:',
        errorNotificacion
      );
    }
  }

  return nuevasAsignaciones;
};
