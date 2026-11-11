// src/services/consultaAcreditacionesExternas.service.ts

import type { Transaction } from 'sequelize';

import {
  Usuario,
  Faena,
  Empresa,
  ContratoExterno,
  UsuarioEmpresaExterna,
  AcreditacionDocumentalExterna,
} from '../models';

export class ErrorConsultaAcreditacionesExternas extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorConsultaAcreditacionesExternas';
  }
}

export interface SolicitudConsultaAcreditacionesExternas {
  usuarioId: number;
  contratoId: number;
  pagina?: number;
  limite?: number;

  // Uso exclusivo del backend.
  transaction?: Transaction;
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

const numeroEnteroValido = (
  valor: unknown
): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Consulta acreditaciones documentales de un contrato externo.
 *
 * Reglas:
 * - usuarioId proviene del JWT verificado.
 * - No se aceptan identificadores empresariales del frontend.
 * - La autorización se determina mediante datos vigentes.
 * - Solo administradores de la mandante o administradores
 *   externos de la contratista pueden consultar.
 * - La empresa del usuario autorizado debe permanecer activa.
 * - No se conceden permisos por errores de otros servicios.
 * - Se utiliza paginación y selección explícita de atributos.
 */
export const obtenerAcreditacionesExternasContrato = async ({
  usuarioId,
  contratoId,
  pagina = 1,
  limite = 20,
  transaction,
}: SolicitudConsultaAcreditacionesExternas) => {
  if (!idValido(usuarioId) || !idValido(contratoId)) {
    throw new ErrorConsultaAcreditacionesExternas(
      400,
      'Identificadores de consulta inválidos.'
    );
  }

  if (
    !numeroEnteroValido(pagina) ||
    !numeroEnteroValido(limite) ||
    limite > 100
  ) {
    throw new ErrorConsultaAcreditacionesExternas(
      400,
      'Paginación inválida.'
    );
  }

  const desplazamiento = (pagina - 1) * limite;

  if (!Number.isSafeInteger(desplazamiento)) {
    throw new ErrorConsultaAcreditacionesExternas(
      400,
      'Paginación fuera del rango permitido.'
    );
  }

  const opcionesTransaccion = transaction
    ? { transaction }
    : {};

  const usuario = await Usuario.findByPk(usuarioId, {
    attributes: ['id', 'rol_id', 'activo', 'faena_id'],
    ...opcionesTransaccion,
  });

  if (!usuario || usuario.activo !== true) {
    throw new ErrorConsultaAcreditacionesExternas(
      403,
      'Usuario sin autorización vigente.'
    );
  }

  const contrato = await ContratoExterno.findByPk(
    contratoId,
    {
      attributes: [
        'id',
        'mandante_empresa_id',
        'contratista_empresa_id',
      ],
      ...opcionesTransaccion,
    }
  );

  if (!contrato) {
    throw new ErrorConsultaAcreditacionesExternas(
      404,
      'Contrato externo no encontrado.'
    );
  }

  let tipoAcceso: 'mandante' | 'contratista' | null = null;
  let empresaAutorizadaId: number | null = null;

  // Verificar explícitamente la autorización de la mandante.
  if (
    usuario.rol_id === 1 &&
    idValido(usuario.faena_id)
  ) {
    const faena = await Faena.findByPk(
      usuario.faena_id,
      {
        attributes: ['id', 'empresa_id'],
        ...opcionesTransaccion,
      }
    );

    const empresaFaenaId = Number(
      faena?.get('empresa_id')
    );

    if (
      idValido(empresaFaenaId) &&
      empresaFaenaId === contrato.mandante_empresa_id
    ) {
      tipoAcceso = 'mandante';
      empresaAutorizadaId = empresaFaenaId;
    }
  }

  // Verificar una vinculación administrativa externa vigente.
  if (tipoAcceso === null) {
    const vinculacion =
      await UsuarioEmpresaExterna.findOne({
        where: {
          usuario_id: usuarioId,
          empresa_id: contrato.contratista_empresa_id,
          perfil: 'administrador_externo',
          activo: true,
        },
        attributes: [
          'id',
          'empresa_id',
          'activo',
        ],
        ...opcionesTransaccion,
      });

    if (vinculacion) {
      tipoAcceso = 'contratista';
      empresaAutorizadaId =
        contrato.contratista_empresa_id;
    }
  }

  if (
    tipoAcceso === null ||
    !idValido(empresaAutorizadaId)
  ) {
    throw new ErrorConsultaAcreditacionesExternas(
      403,
      'No tiene autorización para consultar este contrato.'
    );
  }

  // Comprobar que la empresa autorizada siga activa.
  const empresa = await Empresa.findByPk(
    empresaAutorizadaId,
    {
      attributes: ['id', 'activo'],
      ...opcionesTransaccion,
    }
  );

  if (
    !empresa ||
    empresa.get('activo') !== true
  ) {
    throw new ErrorConsultaAcreditacionesExternas(
      403,
      'La empresa no está habilitada.'
    );
  }

  // La consulta documental siempre queda restringida
  // al contrato expresamente autorizado.
  const { count, rows } =
    await AcreditacionDocumentalExterna.findAndCountAll({
      where: {
        contrato_id: contrato.id,
      },
      attributes: [
        'id',
        'contrato_id',
        'requisito_id',
        'documento_id',
        'contrato_trabajador_id',
        'fecha_emision',
        'fecha_vencimiento',
        'periodo_inicio',
        'periodo_termino',
        'estado',
        'observaciones',
        'presentado_por',
        'revisado_por',
        'fecha_presentacion',
        'fecha_revision',
      ],
      order: [
        ['fecha_presentacion', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: limite,
      offset: desplazamiento,
      ...opcionesTransaccion,
    });

  return {
    contratoId: contrato.id,
    tipoAcceso,
    pagina,
    limite,
    total: count,
    totalPaginas: Math.ceil(count / limite),
    acreditaciones: rows,
  };
};
