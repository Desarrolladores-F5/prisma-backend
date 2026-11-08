// src/services/autorizacionEmpresasExternas.service.ts

import type { Transaction } from 'sequelize';

import {
  Usuario,
  UsuarioEmpresaExterna,
  ContratoExterno,
} from '../models';

export class ErrorAutorizacionEmpresaExterna extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorAutorizacionEmpresaExterna';
  }
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

export interface AutorizacionContratoExterno {
  usuarioId: number;
  empresaId: number;
  contratoId: number;
}

export interface OpcionesAutorizacionEmpresaExterna {
  transaction?: Transaction;
}

/**
 * Autoriza a un administrador externo a operar sobre un contrato
 * perteneciente a su empresa contratista.
 *
 * El usuarioId debe provenir del JWT previamente verificado
 * por validarToken, nunca de req.body.
 *
 * La autorización comprueba datos vigentes en MySQL.
 * No confía en empresa_id ni rol_id enviados por el frontend.
 *
 * Puede recibir una transacción Sequelize para ejecutar
 * todas las consultas dentro de la misma operación.
 */
export const autorizarAdministradorContratoExterno = async (
  usuarioId: number,
  contratoId: number,
  opciones: OpcionesAutorizacionEmpresaExterna = {}
): Promise<AutorizacionContratoExterno> => {
  if (!idValido(usuarioId) || !idValido(contratoId)) {
    throw new ErrorAutorizacionEmpresaExterna(
      400,
      'Identificadores de autorización inválidos.'
    );
  }

  const opcionesTransaccion = opciones.transaction
    ? { transaction: opciones.transaction }
    : {};

  // Comprobar que el usuario exista y siga activo.
  const usuario = await Usuario.findByPk(usuarioId, {
    attributes: ['id', 'activo'],
    ...opcionesTransaccion,
  });

  if (!usuario || usuario.activo !== true) {
    throw new ErrorAutorizacionEmpresaExterna(
      403,
      'Usuario sin autorización vigente.'
    );
  }

  // Identificar la empresa contratista desde el contrato real.
  const contrato = await ContratoExterno.findByPk(contratoId, {
    attributes: ['id', 'contratista_empresa_id'],
    ...opcionesTransaccion,
  });

  if (!contrato) {
    throw new ErrorAutorizacionEmpresaExterna(
      404,
      'Contrato no encontrado.'
    );
  }

  // Comprobar pertenencia y permiso administrativo vigentes.
  const vinculacion = await UsuarioEmpresaExterna.findOne({
    where: {
      usuario_id: usuarioId,
      empresa_id: contrato.contratista_empresa_id,
      perfil: 'administrador_externo',
      activo: true,
    },
    attributes: [
      'id',
      'usuario_id',
      'empresa_id',
      'perfil',
      'activo',
    ],
    ...opcionesTransaccion,
  });

  if (!vinculacion) {
    throw new ErrorAutorizacionEmpresaExterna(
      403,
      'No tiene autorización para administrar este contrato.'
    );
  }

  return {
    usuarioId,
    empresaId: contrato.contratista_empresa_id,
    contratoId: contrato.id,
  };
};
