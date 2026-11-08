// src/services/trabajadoresContratosExternos.service.ts

import type { Transaction } from 'sequelize';

import {
  Usuario,
  UsuarioEmpresaExterna,
  ContratoExternoTrabajador,
} from '../models';

import {
  autorizarAdministradorContratoExterno,
} from './autorizacionEmpresasExternas.service';

export class ErrorTrabajadorContratoExterno extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorTrabajadorContratoExterno';
  }
}

export interface SolicitudVincularTrabajadorExterno {
  administradorId: number;
  contratoId: number;
  trabajadorId: number;
  fechaIncorporacion?: string | null;
  fechaDesvinculacion?: string | null;
  transaction?: Transaction;
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

const fechaValida = (valor: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false;
  }

  const fecha = new Date(`${valor}T00:00:00.000Z`);

  return (
    !Number.isNaN(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === valor
  );
};

const normalizarFecha = (
  valor: string | null | undefined,
  campo: string
): string | null => {
  if (valor === null || valor === undefined) {
    return null;
  }

  if (typeof valor !== 'string' || !fechaValida(valor)) {
    throw new ErrorTrabajadorContratoExterno(
      400,
      `${campo} debe ser una fecha válida con formato YYYY-MM-DD.`
    );
  }

  return valor;
};

/**
 * Vincula un trabajador existente a un contrato externo.
 *
 * Reglas:
 * - El administrador debe estar autorizado para el contrato.
 * - El trabajador debe estar activo.
 * - Debe existir pertenencia empresarial activa.
 * - No se permiten vinculaciones duplicadas.
 * - Las fechas deben ser válidas.
 *
 * El administradorId debe provenir del JWT autenticado.
 */
export const vincularTrabajadorContratoExterno = async ({
  administradorId,
  contratoId,
  trabajadorId,
  fechaIncorporacion,
  fechaDesvinculacion,
  transaction,
}: SolicitudVincularTrabajadorExterno) => {
  if (
    !idValido(administradorId) ||
    !idValido(contratoId) ||
    !idValido(trabajadorId)
  ) {
    throw new ErrorTrabajadorContratoExterno(
      400,
      'Identificadores de vinculación inválidos.'
    );
  }

  const incorporacion = normalizarFecha(
    fechaIncorporacion,
    'La fecha de incorporación'
  );

  const desvinculacion = normalizarFecha(
    fechaDesvinculacion,
    'La fecha de desvinculación'
  );

  if (
    incorporacion &&
    desvinculacion &&
    desvinculacion < incorporacion
  ) {
    throw new ErrorTrabajadorContratoExterno(
      400,
      'La fecha de desvinculación no puede ser anterior a la incorporación.'
    );
  }

  const opcionesTransaccion = transaction
    ? { transaction }
    : {};

  // Autorizar al administrador contra la empresa real del contrato.
  const autorizacion = await autorizarAdministradorContratoExterno(
    administradorId,
    contratoId,
    opcionesTransaccion
  );

  // Comprobar que el trabajador exista y esté activo.
  const trabajador = await Usuario.findByPk(
    trabajadorId,
    {
      attributes: ['id', 'activo'],
      ...opcionesTransaccion,
    }
  );

  if (!trabajador || trabajador.activo !== true) {
    throw new ErrorTrabajadorContratoExterno(
      400,
      'El trabajador no existe o está inactivo.'
    );
  }

  // La pertenencia se verifica contra la empresa del contrato.
  const pertenencia = await UsuarioEmpresaExterna.findOne({
    where: {
      usuario_id: trabajadorId,
      empresa_id: autorizacion.empresaId,
      activo: true,
    },
    attributes: ['id'],
    ...opcionesTransaccion,
  });

  if (!pertenencia) {
    throw new ErrorTrabajadorContratoExterno(
      403,
      'El trabajador no pertenece a la empresa contratista.'
    );
  }

  // Verificar si ya existe una vinculación con este contrato.
  const existente = await ContratoExternoTrabajador.findOne({
    where: {
      contrato_id: contratoId,
      usuario_id: trabajadorId,
    },
    ...opcionesTransaccion,
  });

  if (existente) {
    throw new ErrorTrabajadorContratoExterno(
      409,
      'El trabajador ya está vinculado a este contrato.'
    );
  }

  return ContratoExternoTrabajador.create(
    {
      contrato_id: contratoId,
      usuario_id: trabajadorId,
      fecha_incorporacion: incorporacion,
      fecha_desvinculacion: desvinculacion,
      activo: true,
    },
    opcionesTransaccion
  );
};
