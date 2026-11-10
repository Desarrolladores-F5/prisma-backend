// src/services/consultaContratosExternos.service.ts

import type { Transaction } from 'sequelize';

import { ContratoExterno } from '../models';

import {
  obtenerEmpresaAdministrador,
} from './asignacionDocumental.service';

export interface SolicitudConsultaContratosExternos {
  administradorId: number;
  transaction?: Transaction;
}

export class ErrorConsultaContratosExternos extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorConsultaContratosExternos';
  }
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Consulta únicamente los contratos correspondientes
 * a la empresa mandante del administrador autenticado.
 *
 * El administradorId debe provenir del JWT verificado.
 * La empresa se determina desde MySQL.
 *
 * Nunca se utiliza un identificador de mandante
 * proporcionado por el frontend.
 */
export const obtenerContratosExternosMandante = async ({
  administradorId,
  transaction,
}: SolicitudConsultaContratosExternos): Promise<ContratoExterno[]> => {
  if (!idValido(administradorId)) {
    throw new ErrorConsultaContratosExternos(
      401,
      'Administrador inválido.'
    );
  }

  const mandanteEmpresaId = transaction
    ? await obtenerEmpresaAdministrador(
        administradorId,
        { transaction }
      )
    : await obtenerEmpresaAdministrador(administradorId);

  return ContratoExterno.findAll({
    where: {
      mandante_empresa_id: mandanteEmpresaId,
    },
    order: [['id', 'DESC']],
    ...(transaction ? { transaction } : {}),
  });
};
