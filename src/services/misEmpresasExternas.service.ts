// src/services/misEmpresasExternas.service.ts

import { Op } from 'sequelize';

import {
  Usuario,
  UsuarioEmpresaExterna,
  Empresa,
} from '../models';

export class ErrorConsultaMisEmpresasExternas extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorConsultaMisEmpresasExternas';
  }
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

export interface EmpresaExternaVinculada {
  empresaId: number;
  nombre: string;
  perfil: 'administrador_externo' | 'trabajador';
}

export interface ResultadoMisEmpresasExternas {
  empresas: EmpresaExternaVinculada[];
}

/**
 * Consulta las empresas externas asociadas al usuario autenticado.
 *
 * Seguridad:
 * - El usuarioId debe provenir del JWT verificado.
 * - Solo se consideran usuarios activos.
 * - Solo se consideran vinculaciones activas.
 * - Solo se devuelven empresas activas.
 * - No se exponen datos privados de las empresas.
 * - Esta consulta no concede permisos sobre contratos.
 */
export const obtenerMisEmpresasExternas = async (
  usuarioId: number
): Promise<ResultadoMisEmpresasExternas> => {
  if (!idValido(usuarioId)) {
    throw new ErrorConsultaMisEmpresasExternas(
      400,
      'Identificador de usuario inválido.'
    );
  }

  const usuario = await Usuario.findByPk(usuarioId, {
    attributes: ['id', 'activo'],
  });

  if (!usuario || usuario.activo !== true) {
    throw new ErrorConsultaMisEmpresasExternas(
      403,
      'Usuario sin autorización vigente.'
    );
  }

  const vinculaciones =
    await UsuarioEmpresaExterna.findAll({
      where: {
        usuario_id: usuarioId,
        activo: true,
        perfil: {
          [Op.in]: [
            'administrador_externo',
            'trabajador',
          ],
        },
      },
      attributes: [
        'empresa_id',
        'perfil',
      ],
      order: [
        ['empresa_id', 'ASC'],
        ['perfil', 'ASC'],
      ],
    });

  if (vinculaciones.length === 0) {
    return { empresas: [] };
  }

  const empresaIds = [
    ...new Set(
      vinculaciones.map(
        vinculacion => vinculacion.empresa_id
      )
    ),
  ];

  const empresasActivas = await Empresa.findAll({
    where: {
      id: {
        [Op.in]: empresaIds,
      },
      activo: true,
    },
    attributes: [
      'id',
      'nombre',
    ],
  });

  const empresasPorId = new Map<number, string>();

  for (const empresa of empresasActivas) {
    const id = Number(empresa.get('id'));
    const nombre = empresa.get('nombre');

    if (
      idValido(id) &&
      typeof nombre === 'string'
    ) {
      empresasPorId.set(id, nombre);
    }
  }

  const resultado: EmpresaExternaVinculada[] = [];

  for (const vinculacion of vinculaciones) {
    const empresaId = vinculacion.empresa_id;
    const nombre = empresasPorId.get(empresaId);

    if (nombre === undefined) {
      continue;
    }

    resultado.push({
      empresaId,
      nombre,
      perfil: vinculacion.perfil,
    });
  }

  return {
    empresas: resultado,
  };
};
