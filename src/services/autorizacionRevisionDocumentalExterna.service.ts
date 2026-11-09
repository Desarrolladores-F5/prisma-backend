// src/services/autorizacionRevisionDocumentalExterna.service.ts

import type { Transaction } from 'sequelize';

import {
  AcreditacionDocumentalExterna,
  ContratoExterno,
  Empresa,
} from '../models';

import {
  obtenerEmpresaAdministrador,
} from './asignacionDocumental.service';

export class ErrorAutorizacionRevisionExterna extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorAutorizacionRevisionExterna';
  }
}

export interface SolicitudAutorizacionRevisionExterna {
  administradorId: number;
  acreditacionId: number;
  transaction?: Transaction;
}

export interface AutorizacionRevisionExterna {
  administradorId: number;
  acreditacionId: number;
  contratoId: number;
  mandanteEmpresaId: number;
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Autoriza a un administrador de la mandante
 * a revisar una acreditación documental externa.
 *
 * No modifica el estado de la acreditación.
 *
 * administradorId debe provenir del JWT verificado.
 * Nunca debe aceptarse desde req.body.
 *
 * Cuando se proporciona una transacción, todas las
 * consultas de autorización utilizan esa transacción:
 *
 * - Identificación del administrador.
 * - Identificación de su faena y empresa.
 * - Consulta de la acreditación.
 * - Consulta del contrato.
 * - Validación de la empresa mandante.
 *
 * La autorización por sí sola no sustituye las
 * protecciones de concurrencia que deberá implementar
 * el servicio de aprobación y rechazo.
 */
export const autorizarRevisionDocumentalExterna = async ({
  administradorId,
  acreditacionId,
  transaction,
}: SolicitudAutorizacionRevisionExterna): Promise<
  AutorizacionRevisionExterna
> => {
  if (
    !idValido(administradorId) ||
    !idValido(acreditacionId)
  ) {
    throw new ErrorAutorizacionRevisionExterna(
      400,
      'Identificadores de revisión documental inválidos.'
    );
  }

  const opcionesTransaccion = transaction
    ? { transaction }
    : {};

  // Identificar la empresa real del administrador.
  // Se validan su rol, cuenta activa y faena desde MySQL.
  const mandanteEmpresaId =
    await obtenerEmpresaAdministrador(
      administradorId,
      opcionesTransaccion
    );

  // Identificar la acreditación sin confiar en
  // identificadores de contrato enviados por el frontend.
  const acreditacion =
    await AcreditacionDocumentalExterna.findByPk(
      acreditacionId,
      {
        attributes: ['id', 'contrato_id'],
        ...opcionesTransaccion,
      }
    );

  if (!acreditacion) {
    throw new ErrorAutorizacionRevisionExterna(
      404,
      'Acreditación documental no encontrada.'
    );
  }

  const contrato = await ContratoExterno.findByPk(
    acreditacion.contrato_id,
    {
      attributes: ['id', 'mandante_empresa_id'],
      ...opcionesTransaccion,
    }
  );

  if (!contrato) {
    throw new ErrorAutorizacionRevisionExterna(
      404,
      'Contrato de la acreditación no encontrado.'
    );
  }

  // La acreditación solamente puede ser revisada
  // por un administrador de su propia mandante.
  if (
    contrato.mandante_empresa_id !== mandanteEmpresaId
  ) {
    throw new ErrorAutorizacionRevisionExterna(
      403,
      'No tiene autorización para revisar esta acreditación.'
    );
  }

  // Comprobar que la mandante continúe activa.
  const mandante = await Empresa.findByPk(
    mandanteEmpresaId,
    {
      attributes: ['id', 'activo'],
      ...opcionesTransaccion,
    }
  );

  if (
    !mandante ||
    mandante.get('activo') !== true
  ) {
    throw new ErrorAutorizacionRevisionExterna(
      403,
      'La empresa mandante no está habilitada.'
    );
  }

  return {
    administradorId,
    acreditacionId: acreditacion.id,
    contratoId: contrato.id,
    mandanteEmpresaId,
  };
};
