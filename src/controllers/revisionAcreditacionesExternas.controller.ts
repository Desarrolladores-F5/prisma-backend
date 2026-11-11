// src/controllers/revisionAcreditacionesExternas.controller.ts

import type { Request, Response } from 'express';

import type {
  RequestConUsuario,
} from '../middlewares/validarToken';

import {
  revisarAcreditacionDocumentalExterna,
  ErrorRevisionAcreditacionExterna,
} from '../services/revisionAcreditacionDocumentalExterna.service';

import type {
  AccionRevisionAcreditacionExterna,
} from '../services/revisionAcreditacionDocumentalExterna.service';

import {
  ErrorAutorizacionRevisionExterna,
} from '../services/autorizacionRevisionDocumentalExterna.service';

import {
  ErrorAsignacionDocumental,
} from '../services/asignacionDocumental.service';

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

const accionValida = (
  valor: unknown
): valor is AccionRevisionAcreditacionExterna =>
  valor === 'iniciar_revision' ||
  valor === 'aprobar' ||
  valor === 'rechazar';

const observacionesValidas = (
  valor: unknown
): valor is string | null | undefined =>
  valor === undefined ||
  valor === null ||
  typeof valor === 'string';

/**
 * PATCH /api/contratos-externos/acreditaciones/:acreditacionId/revision
 *
 * Permite que un administrador de la empresa mandante
 * inicie, apruebe o rechace una revisión documental.
 *
 * La identidad se obtiene exclusivamente del JWT.
 * La empresa mandante se identifica desde MySQL.
 *
 * Nunca se admiten administradorId, empresaId,
 * estado, revisado_por ni transaction desde req.body.
 */
export const revisarAcreditacionExternaHttp = async (
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

  const parametroAcreditacion = req.params.acreditacionId;

  if (
    typeof parametroAcreditacion !== 'string' ||
    !/^[1-9]\d*$/.test(parametroAcreditacion)
  ) {
    res.status(400).json({
      mensaje: 'Identificador de acreditación inválido.',
    });
    return;
  }

  const acreditacionId = Number(parametroAcreditacion);

  if (!idValido(acreditacionId)) {
    res.status(400).json({
      mensaje: 'Identificador de acreditación inválido.',
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
    'accion',
    'observaciones',
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

  if (!accionValida(cuerpo.accion)) {
    res.status(400).json({
      mensaje: 'La acción de revisión documental es inválida.',
    });
    return;
  }

  if (!observacionesValidas(cuerpo.observaciones)) {
    res.status(400).json({
      mensaje: 'Las observaciones deben ser texto o un valor nulo.',
    });
    return;
  }

  const observaciones = cuerpo.observaciones;

  if (
    typeof observaciones === 'string' &&
    observaciones.trim().length > 2000
  ) {
    res.status(400).json({
      mensaje: 'Las observaciones no pueden superar 2000 caracteres.',
    });
    return;
  }

  if (
    cuerpo.accion === 'rechazar' &&
    (
      typeof observaciones !== 'string' ||
      observaciones.trim().length === 0
    )
  ) {
    res.status(400).json({
      mensaje: 'El rechazo requiere observaciones.',
    });
    return;
  }

  try {
    const revision =
      await revisarAcreditacionDocumentalExterna({
        administradorId: usuario.id,
        acreditacionId,
        accion: cuerpo.accion,
        observaciones,
      });

    res.status(200).json({
      mensaje: 'Revisión documental procesada correctamente.',
      revision,
    });
  } catch (error) {
    if (
      error instanceof ErrorRevisionAcreditacionExterna ||
      error instanceof ErrorAutorizacionRevisionExterna ||
      error instanceof ErrorAsignacionDocumental
    ) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al revisar acreditación externa:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible procesar la revisión documental.',
    });
  }
};
