// src/services/revisionAcreditacionDocumentalExterna.service.ts

import type { Transaction } from 'sequelize';

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../models';

import {
  autorizarRevisionDocumentalExterna,
} from './autorizacionRevisionDocumentalExterna.service';

export class ErrorRevisionAcreditacionExterna extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorRevisionAcreditacionExterna';
  }
}

export type AccionRevisionAcreditacionExterna =
  | 'iniciar_revision'
  | 'aprobar'
  | 'rechazar';

export interface SolicitudRevisionAcreditacionExterna {
  administradorId: number;
  acreditacionId: number;
  accion: AccionRevisionAcreditacionExterna;
  observaciones?: string | null;

  // Uso interno del backend, nunca desde req.body.
  transaction?: Transaction;
}

const accionesValidas: AccionRevisionAcreditacionExterna[] = [
  'iniciar_revision',
  'aprobar',
  'rechazar',
];

const normalizarObservaciones = (
  valor: unknown
): string | null => {
  if (valor === null || valor === undefined) {
    return null;
  }

  if (typeof valor !== 'string') {
    throw new ErrorRevisionAcreditacionExterna(
      400,
      'Las observaciones deben ser texto.'
    );
  }

  const texto = valor.trim();

  if (texto.length > 2000) {
    throw new ErrorRevisionAcreditacionExterna(
      400,
      'Las observaciones no pueden superar 2000 caracteres.'
    );
  }

  return texto || null;
};

/**
 * Gestiona la revisión documental de una acreditación externa.
 *
 * Reglas de seguridad:
 *
 * - administradorId proviene del JWT verificado.
 * - La mandante se valida mediante MySQL.
 * - La contratista no puede aprobar sus documentos.
 * - Solamente el administrador que inicia una revisión
 *   puede aprobarla o rechazarla.
 * - No se permite modificar acreditaciones finalizadas.
 * - Los UPDATE son condicionales para evitar que dos
 *   solicitudes completen la misma transición.
 * - La operación utiliza una transacción Sequelize.
 *
 * Si se recibe una transacción externa, el llamador
 * administra su COMMIT o ROLLBACK.
 *
 * Si no se recibe, Sequelize gestiona la transacción.
 */
export const revisarAcreditacionDocumentalExterna = async ({
  administradorId,
  acreditacionId,
  accion,
  observaciones,
  transaction: transaccionExterna,
}: SolicitudRevisionAcreditacionExterna) => {
  if (!accionesValidas.includes(accion)) {
    throw new ErrorRevisionAcreditacionExterna(
      400,
      'La acción de revisión documental es inválida.'
    );
  }

  const observacionNormalizada =
    normalizarObservaciones(observaciones);

  if (
    accion === 'rechazar' &&
    !observacionNormalizada
  ) {
    throw new ErrorRevisionAcreditacionExterna(
      400,
      'El rechazo requiere observaciones.'
    );
  }

  const ejecutarRevision = async (
    transaction: Transaction
  ) => {
    // Verificar la identidad del administrador y
    // su pertenencia a la mandante del contrato.
    const autorizacion =
      await autorizarRevisionDocumentalExterna({
        administradorId,
        acreditacionId,
        transaction,
      });

    const acreditacion =
      await AcreditacionDocumentalExterna.findByPk(
        autorizacion.acreditacionId,
        {
          attributes: [
            'id',
            'contrato_id',
            'estado',
            'revisado_por',
          ],
          transaction,
        }
      );

    if (!acreditacion) {
      throw new ErrorRevisionAcreditacionExterna(
        404,
        'Acreditación documental no encontrada.'
      );
    }

    // Impedir que el registro cambie de contrato
    // entre la autorización y la lectura.
    if (
      acreditacion.contrato_id !== autorizacion.contratoId
    ) {
      throw new ErrorRevisionAcreditacionExterna(
        409,
        'La acreditación cambió durante la revisión.'
      );
    }

    if (accion === 'iniciar_revision') {
      if (acreditacion.estado !== 'pendiente') {
        throw new ErrorRevisionAcreditacionExterna(
          409,
          'Solo una acreditación pendiente puede iniciar revisión.'
        );
      }

      const [actualizadas] =
        await AcreditacionDocumentalExterna.update(
          {
            estado: 'en_revision',
            revisado_por: autorizacion.administradorId,
          },
          {
            where: {
              id: autorizacion.acreditacionId,
              contrato_id: autorizacion.contratoId,
              estado: 'pendiente',
              revisado_por: null,
            },
            transaction,
          }
        );

      if (actualizadas !== 1) {
        throw new ErrorRevisionAcreditacionExterna(
          409,
          'Otra solicitud inició la revisión de esta acreditación.'
        );
      }

      return {
        acreditacionId: autorizacion.acreditacionId,
        contratoId: autorizacion.contratoId,
        estado: 'en_revision' as const,
        revisadoPor: autorizacion.administradorId,
      };
    }

    // Aprobar y rechazar requieren una revisión iniciada.
    if (acreditacion.estado !== 'en_revision') {
      throw new ErrorRevisionAcreditacionExterna(
        409,
        'La acreditación debe estar en revisión.'
      );
    }

    // Solo el administrador que inició la revisión
    // puede emitir la decisión final.
    if (
      acreditacion.revisado_por !==
      autorizacion.administradorId
    ) {
      throw new ErrorRevisionAcreditacionExterna(
        403,
        'La revisión está asignada a otro administrador.'
      );
    }

    const nuevoEstado =
      accion === 'aprobar' ? 'aprobado' : 'rechazado';

    const fechaRevision = new Date();

    const [actualizadas] =
      await AcreditacionDocumentalExterna.update(
        {
          estado: nuevoEstado,
          observaciones: observacionNormalizada,
          revisado_por: autorizacion.administradorId,
          fecha_revision: fechaRevision,
        },
        {
          where: {
            id: autorizacion.acreditacionId,
            contrato_id: autorizacion.contratoId,
            estado: 'en_revision',
            revisado_por: autorizacion.administradorId,
          },
          transaction,
        }
      );

    if (actualizadas !== 1) {
      throw new ErrorRevisionAcreditacionExterna(
        409,
        'La acreditación fue modificada por otra solicitud.'
      );
    }

    return {
      acreditacionId: autorizacion.acreditacionId,
      contratoId: autorizacion.contratoId,
      estado: nuevoEstado,
      revisadoPor: autorizacion.administradorId,
      fechaRevision,
      observaciones: observacionNormalizada,
    };
  };

  if (transaccionExterna) {
    return ejecutarRevision(transaccionExterna);
  }

  return sequelize.transaction(ejecutarRevision);
};
