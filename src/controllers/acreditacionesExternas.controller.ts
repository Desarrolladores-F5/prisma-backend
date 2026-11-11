// src/controllers/acreditacionesExternas.controller.ts

import type { Request, Response } from 'express';

import {
  registrarAcreditacionDocumentalExterna,
  ErrorRegistroAcreditacionExterna,
} from '../services/registroAcreditacionDocumentalExterna.service';

import {
  ErrorPresentacionDocumentalExterna,
} from '../services/autorizacionPresentacionDocumentalExterna.service';

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

const idOpcionalValido = (
  valor: unknown
): valor is number | null | undefined =>
  valor === undefined ||
  valor === null ||
  idValido(valor);

/**
 * POST /api/contratos-externos/:contratoId/acreditaciones
 *
 * Registra la presentación de una acreditación documental.
 *
 * La identidad proviene exclusivamente del JWT.
 * Los permisos empresariales y documentales se verifican
 * mediante los servicios existentes.
 *
 * Nunca acepta estado, presentado_por, revisado_por
 * ni transacciones desde el frontend.
 */
export const registrarAcreditacionExternaHttp = async (
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
    'requisitoId',
    'documentoId',
    'contratoTrabajadorId',
    'fechaEmision',
    'fechaVencimiento',
    'periodoInicio',
    'periodoTermino',
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

  if (
    !idValido(cuerpo.requisitoId) ||
    !idValido(cuerpo.documentoId)
  ) {
    res.status(400).json({
      mensaje: 'Identificadores documentales inválidos.',
    });
    return;
  }

  const contratoTrabajadorId = cuerpo.contratoTrabajadorId;

  if (!idOpcionalValido(contratoTrabajadorId)) {
    res.status(400).json({
      mensaje: 'Identificador de trabajador vinculado inválido.',
    });
    return;
  }

  const fechaEmision = cuerpo.fechaEmision;
  const fechaVencimiento = cuerpo.fechaVencimiento;
  const periodoInicio = cuerpo.periodoInicio;
  const periodoTermino = cuerpo.periodoTermino;

  if (
    !fechaConTipoValido(fechaEmision) ||
    !fechaConTipoValido(fechaVencimiento) ||
    !fechaConTipoValido(periodoInicio) ||
    !fechaConTipoValido(periodoTermino)
  ) {
    res.status(400).json({
      mensaje: 'Las fechas deben ser cadenas de texto o valores nulos.',
    });
    return;
  }

  try {
    const acreditacion =
      await registrarAcreditacionDocumentalExterna({
        administradorId: usuario.id,
        contratoId,
        requisitoId: cuerpo.requisitoId,
        documentoId: cuerpo.documentoId,
        contratoTrabajadorId,
        fechaEmision,
        fechaVencimiento,
        periodoInicio,
        periodoTermino,
      });

    res.status(201).json({
      mensaje: 'Acreditación documental presentada correctamente.',
      acreditacion,
    });
  } catch (error) {
    if (
      error instanceof ErrorRegistroAcreditacionExterna ||
      error instanceof ErrorPresentacionDocumentalExterna ||
      error instanceof ErrorAutorizacionEmpresaExterna
    ) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al registrar acreditación externa:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible presentar la acreditación documental.',
    });
  }
};
