import { sequelize, Documento } from '../models';
import {
  resolverDestinatariosDocumento,
  obtenerEmpresaAdministrador,
} from './asignacionDocumental.service';
import {
  registrarAsignacionesDocumentales,
} from './registroAsignacionesDocumentales.service';
import {
  avisarAsignacionDocumental,
} from './notificacionesAutomaticas.service';

interface SolicitudCreacionDocumental {
  administradorId: number;
  nombre: string;
  tipo: string;
  url: string;
  version: string;
  asignacionTipo: 'usuarios' | 'rol' | 'todos';
  usuarioIds?: number[];
  rolId?: number;
}

export const crearDocumentoConAsignaciones = async ({
  administradorId,
  nombre,
  tipo,
  url,
  version,
  asignacionTipo,
  usuarioIds,
  rolId,
}: SolicitudCreacionDocumental) => {
  if (
    !nombre?.trim() ||
    !tipo?.trim() ||
    !url?.trim() ||
    !version?.trim()
  ) {
    throw new Error('Faltan datos obligatorios del documento.');
  }

  // Validar la empresa real del administrador.
  const empresaId = await obtenerEmpresaAdministrador(administradorId);

  // Validar los destinatarios antes de crear registros.
  const destinatarios = await resolverDestinatariosDocumento({
    administradorId,
    asignacionTipo,
    usuarioIds,
    rolId,
  });

  const transaccion = await sequelize.transaction();
  let commitIniciado = false;

  let documentoCreado;

  try {
    documentoCreado = await Documento.create(
      {
        nombre,
        tipo,
        url,
        version,
        empresa_id: empresaId,
      },
      {
        transaction: transaccion,
      }
    );

    await registrarAsignacionesDocumentales({
      documentoId: documentoCreado.id,
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
          'Error al revertir la creación documental:',
          errorRollback
        );
      }
    }

    throw error;
  }

  // Las notificaciones se envían después del commit.
  // Una falla de notificación no invalida el documento creado.
  try {
    await avisarAsignacionDocumental({
      documentoId: documentoCreado.id,
      nombreDocumento: documentoCreado.nombre,
      destinatariosIds: destinatarios,
    });
  } catch (errorNotificacion) {
    console.error(
      'Documento creado, pero falló la notificación:',
      errorNotificacion
    );
  }

  return documentoCreado;
};
