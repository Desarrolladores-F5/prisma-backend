import { sequelize } from '../models';
import {
  resolverDestinatariosDocumento,
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
  // Validar antes de iniciar cualquier escritura.
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

  // La asignación ya está confirmada.
  // Los avisos no deben afectar la transacción documental.
  if (nuevasAsignaciones.length > 0) {
    try {
      await avisarAsignacionDocumental({
        documentoId,
        nombreDocumento,
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
