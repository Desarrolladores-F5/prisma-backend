// src/services/autorizacionPresentacionDocumentalExterna.service.ts

import { QueryTypes } from 'sequelize';
import type { Transaction } from 'sequelize';

import { sequelize } from '../models';

import {
  autorizarAdministradorContratoExterno,
} from './autorizacionEmpresasExternas.service';

export class ErrorPresentacionDocumentalExterna extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorPresentacionDocumentalExterna';
  }
}

export interface SolicitudAutorizacionPresentacionExterna {
  administradorId: number;
  contratoId: number;
  requisitoId: number;
  documentoId: number;
  contratoTrabajadorId?: number | null;
  transaction?: Transaction;
}

export interface AutorizacionPresentacionExterna {
  administradorId: number;
  contratoId: number;
  empresaId: number;
  requisitoId: number;
  documentoId: number;
  contratoTrabajadorId: number | null;
  destinatario: 'empresa' | 'trabajador';
}

interface ResultadoValidacionDocumental {
  contrato_id: number;
  contratista_empresa_id: number;
  estado_contrato: string;
  empresa_activa: number | boolean;
  requisito_id: number;
  destinatario: 'empresa' | 'trabajador';
  documento_id: number;
  empresa_documento_id: number | null;
  trabajador_vinculado_id: number | null;
  trabajador_activo: number | boolean | null;
  usuario_trabajador_activo: number | boolean | null;
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Autoriza la presentación de un documento existente
 * como evidencia de un requisito contractual externo.
 *
 * No crea acreditaciones ni aprueba documentos.
 *
 * El administradorId debe provenir del JWT verificado,
 * nunca de un identificador enviado por el frontend.
 *
 * Las consultas pueden ejecutarse dentro de una
 * transacción Sequelize proporcionada por el servicio
 * que posteriormente registre la acreditación.
 */
export const autorizarPresentacionDocumentalExterna = async ({
  administradorId,
  contratoId,
  requisitoId,
  documentoId,
  contratoTrabajadorId = null,
  transaction,
}: SolicitudAutorizacionPresentacionExterna): Promise<
  AutorizacionPresentacionExterna
> => {
  if (
    !idValido(administradorId) ||
    !idValido(contratoId) ||
    !idValido(requisitoId) ||
    !idValido(documentoId)
  ) {
    throw new ErrorPresentacionDocumentalExterna(
      400,
      'Identificadores de presentación documental inválidos.'
    );
  }

  if (
    contratoTrabajadorId !== null &&
    !idValido(contratoTrabajadorId)
  ) {
    throw new ErrorPresentacionDocumentalExterna(
      400,
      'Identificador de trabajador vinculado inválido.'
    );
  }

  const opcionesTransaccion = transaction
    ? { transaction }
    : {};

  // Autorizar primero al administrador de la contratista.
  const autorizacion = await autorizarAdministradorContratoExterno(
    administradorId,
    contratoId,
    opcionesTransaccion
  );

  // Validación empresarial y documental con datos reales.
  const registros = await sequelize.query<ResultadoValidacionDocumental>(
    `
      SELECT
        c.id AS contrato_id,
        c.contratista_empresa_id,
        c.estado AS estado_contrato,

        e.activo AS empresa_activa,

        r.id AS requisito_id,
        r.destinatario,

        d.id AS documento_id,
        d.empresa_id AS empresa_documento_id,

        ct.id AS trabajador_vinculado_id,
        ct.activo AS trabajador_activo,

        u.activo AS usuario_trabajador_activo

      FROM contratos_externos c

      INNER JOIN empresas e
        ON e.id = c.contratista_empresa_id

      INNER JOIN requisitos_documentales_externos r
        ON r.contrato_id = c.id
       AND r.id = :requisitoId
       AND r.activo = 1

      INNER JOIN documentos d
        ON d.id = :documentoId

      LEFT JOIN contratos_externos_trabajadores ct
        ON ct.id = :contratoTrabajadorId
       AND ct.contrato_id = c.id

      LEFT JOIN usuarios u
        ON u.id = ct.usuario_id

      WHERE c.id = :contratoId
        AND c.contratista_empresa_id = :empresaId

      LIMIT 1
    `,
    {
      replacements: {
        contratoId,
        requisitoId,
        documentoId,
        contratoTrabajadorId,
        empresaId: autorizacion.empresaId,
      },
      type: QueryTypes.SELECT,
      ...opcionesTransaccion,
    }
  );

  const registro = registros[0];

  if (!registro) {
    throw new ErrorPresentacionDocumentalExterna(
      403,
      'El requisito o documento no está disponible para este contrato.'
    );
  }

  // La contratista debe continuar activa.
  if (Number(registro.empresa_activa) !== 1) {
    throw new ErrorPresentacionDocumentalExterna(
      403,
      'La empresa contratista se encuentra inactiva.'
    );
  }

  // Pendiente: acreditación inicial.
  // Activo: presentación y renovación documental.
  if (!['pendiente', 'activo'].includes(registro.estado_contrato)) {
    throw new ErrorPresentacionDocumentalExterna(
      403,
      'El contrato no admite presentaciones documentales.'
    );
  }

  // Un documento privado de otra empresa no puede
  // presentarse como evidencia de esta contratista.
  if (
    Number(registro.empresa_documento_id) !==
    autorizacion.empresaId
  ) {
    throw new ErrorPresentacionDocumentalExterna(
      403,
      'El documento no pertenece a la empresa contratista.'
    );
  }

  if (registro.destinatario === 'empresa') {
    if (contratoTrabajadorId !== null) {
      throw new ErrorPresentacionDocumentalExterna(
        400,
        'Un requisito empresarial no debe vincularse a un trabajador.'
      );
    }
  } else if (registro.destinatario === 'trabajador') {
    if (contratoTrabajadorId === null) {
      throw new ErrorPresentacionDocumentalExterna(
        400,
        'El requisito exige identificar al trabajador vinculado.'
      );
    }

    if (
      registro.trabajador_vinculado_id === null ||
      Number(registro.trabajador_activo) !== 1 ||
      Number(registro.usuario_trabajador_activo) !== 1
    ) {
      throw new ErrorPresentacionDocumentalExterna(
        403,
        'El trabajador no mantiene una vinculación activa con el contrato.'
      );
    }
  } else {
    throw new ErrorPresentacionDocumentalExterna(
      400,
      'El requisito tiene un destinatario inválido.'
    );
  }

  return {
    administradorId,
    contratoId,
    empresaId: autorizacion.empresaId,
    requisitoId,
    documentoId,
    contratoTrabajadorId,
    destinatario: registro.destinatario,
  };
};
