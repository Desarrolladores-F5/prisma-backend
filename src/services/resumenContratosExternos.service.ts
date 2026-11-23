// src/services/resumenContratosExternos.service.ts

import type { Transaction } from 'sequelize';

import { ContratoExterno } from '../models';

import {
  obtenerEmpresaAdministrador,
} from './asignacionDocumental.service';

export interface SolicitudResumenContratosExternos {
  administradorId: number;
  transaction?: Transaction;
}

export interface ResumenContratoExterno {
  id: number;
  nombre: string;
  numero_contrato: string | null;
  estado: string;
  contratista_empresa_id: number;
  faena_id: number;
  contrato_principal_id: number | null;
  tipo: 'contratista' | 'subcontratista';
  contratista: {
    id: number;
    nombre: string;
    rut: string | null;
  };
  faena: {
    id: number;
    nombre: string;
  };
  contrato_principal: {
    id: number;
    nombre: string;
    faena_id: number;
    contratista_empresa_id: number;
  } | null;
}

export class ErrorResumenContratosExternos extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorResumenContratosExternos';
  }
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Consulta los contratos externos pertenecientes exclusivamente
 * a la empresa mandante del administrador autenticado.
 *
 * La mandante se determina desde MySQL, nunca desde parámetros
 * proporcionados por el frontend.
 *
 * Se comprueba:
 * - Pertenencia del contrato a la mandante.
 * - Pertenencia de la faena a la mandante.
 * - Pertenencia del contrato principal a la misma mandante.
 * - Coincidencia de faena entre contrato y contrato principal.
 * - Diferencia entre contratista y subcontratista.
 *
 * No modifica contratos ni documentación.
 */
export const obtenerResumenContratosExternos = async ({
  administradorId,
  transaction,
}: SolicitudResumenContratosExternos): Promise<ResumenContratoExterno[]> => {
  if (!idValido(administradorId)) {
    throw new ErrorResumenContratosExternos(
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

  const contratos = await ContratoExterno.findAll({
    where: {
      mandante_empresa_id: mandanteEmpresaId,
    },
    include: [
      {
        association: 'contratista',
        attributes: ['id', 'nombre', 'rut'],
        required: true,
      },
      {
        association: 'faena',
        attributes: ['id', 'nombre'],
        required: true,
        where: {
          empresa_id: mandanteEmpresaId,
        },
      },
      {
        association: 'contrato_principal',
        attributes: [
          'id',
          'nombre',
          'faena_id',
          'contratista_empresa_id',
        ],
        required: false,
        where: {
          mandante_empresa_id: mandanteEmpresaId,
        },
      },
    ],
    order: [['id', 'DESC']],
    ...(transaction ? { transaction } : {}),
  });

  return contratos.flatMap(registro => {
    const contrato = registro.get({
      plain: true,
    }) as unknown as ResumenContratoExterno;

    if (!contrato.contratista || !contrato.faena) {
      return [];
    }

    const esSubcontrato = contrato.contrato_principal_id !== null;

    if (esSubcontrato) {
      const principal = contrato.contrato_principal;

      if (!principal) {
        return [];
      }

      if (
        principal.id !== contrato.contrato_principal_id ||
        principal.faena_id !== contrato.faena_id ||
        principal.contratista_empresa_id ===
          contrato.contratista_empresa_id
      ) {
        return [];
      }
    }

    return [{
      id: contrato.id,
      nombre: contrato.nombre,
      numero_contrato: contrato.numero_contrato,
      estado: contrato.estado,
      contratista_empresa_id: contrato.contratista_empresa_id,
      faena_id: contrato.faena_id,
      contrato_principal_id: contrato.contrato_principal_id,
      tipo: esSubcontrato ? 'subcontratista' : 'contratista',
      contratista: contrato.contratista,
      faena: contrato.faena,
      contrato_principal: esSubcontrato
        ? contrato.contrato_principal
        : null,
    }];
  });
};
