// src/controllers/trabajadoresContratosExternos.controller.ts

import type { Request, Response } from 'express';

import {
  vincularTrabajadorContratoExterno,
  ErrorTrabajadorContratoExterno,
} from '../services/trabajadoresContratosExternos.service';

import {
  ErrorAutorizacionEmpresaExterna,
} from '../services/autorizacionEmpresasExternas.service';

import type {
  RequestConUsuario,
} from '../middlewares/validarToken';

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

const esObjeto = (
  valor: unknown
): valor is Record<string, unknown> =>
  typeof valor === 'object' &&
  valor !== null &&
  !Array.isArray(valor);

const fechaConTipoValido = (
  valor: unknown
): valor is string | null | undefined =>
  valor === undefined ||
  valor === null ||
  typeof valor === 'string';

/**
 * POST /api/contratos-externos/:contratoId/trabajadores
 *
 * Vincula un trabajador existente con un contrato externo.
 *
 * La identidad del administrador proviene del JWT.
 * La autorización empresarial se comprueba en MySQL.
 */
export const vincularTrabajadorContratoExternoHttp = async (
  req: Request,
  res: Response
): Promise<void> => {
  const usuario = (req as RequestConUsuario).usuario;

  if (!idValido(usuario?.id)) {
    res.status(401).json({
      mensaje: 'Usuario no autenticado.',
    });
    return;
  }

  const parametroContrato = req.params.contratoId;

  if (
    typeof parametroContrato !== 'string' ||
    !/^[1-9]\d*$/.test(parametroContrato)
  ) {
    res.status(400).json({
      mensaje: 'Identificador de contrato inválido.',
    });
    return;
  }

  const contratoId = Number(parametroContrato);

  if (!idValido(contratoId)) {
    res.status(400).json({
      mensaje: 'Identificador de contrato inválido.',
    });
    return;
  }

  if (!esObjeto(req.body)) {
    res.status(400).json({
      mensaje: 'El cuerpo de la solicitud es inválido.',
    });
    return;
  }

  const cuerpo = req.body;

  const camposPermitidos = new Set([
    'trabajadorId',
    'fechaIncorporacion',
    'fechaDesvinculacion',
  ]);

  if (
    Object.keys(cuerpo).some(
      campo => !camposPermitidos.has(campo)
    )
  ) {
    res.status(400).json({
      mensaje: 'La solicitud contiene campos no permitidos.',
    });
    return;
  }

  if (!idValido(cuerpo.trabajadorId)) {
    res.status(400).json({
      mensaje: 'Identificador de trabajador inválido.',
    });
    return;
  }

  const fechaIncorporacion = cuerpo.fechaIncorporacion;
  const fechaDesvinculacion = cuerpo.fechaDesvinculacion;

  if (
    !fechaConTipoValido(fechaIncorporacion) ||
    !fechaConTipoValido(fechaDesvinculacion)
  ) {
    res.status(400).json({
      mensaje: 'Las fechas deben ser cadenas de texto o valores nulos.',
    });
    return;
  }

  try {
    const vinculacion = await vincularTrabajadorContratoExterno({
      administradorId: usuario.id,
      contratoId,
      trabajadorId: cuerpo.trabajadorId,
      fechaIncorporacion,
      fechaDesvinculacion,
    });

    res.status(201).json({
      mensaje: 'Trabajador vinculado correctamente al contrato.',
      vinculacion,
    });
  } catch (error) {
    if (
      error instanceof ErrorTrabajadorContratoExterno ||
      error instanceof ErrorAutorizacionEmpresaExterna
    ) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al vincular trabajador externo:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible vincular el trabajador al contrato.',
    });
  }
};
