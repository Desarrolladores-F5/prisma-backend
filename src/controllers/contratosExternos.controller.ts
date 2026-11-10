// src/controllers/contratosExternos.controller.ts

import type { Request, Response } from 'express';

import {
  crearContratoExterno,
  ErrorContratoExterno,
} from '../services/contratosExternos.service';

import type {
  SolicitudCrearContratoExterno,
} from '../services/contratosExternos.service';

import {
  obtenerContratosExternosMandante,
  ErrorConsultaContratosExternos,
} from '../services/consultaContratosExternos.service';

import {
  ErrorAsignacionDocumental,
} from '../services/asignacionDocumental.service';

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

/**
 * POST /api/contratos-externos
 *
 * Crea un contrato externo desde una empresa mandante.
 *
 * El administrador se identifica mediante el JWT.
 * La empresa mandante se determina desde MySQL.
 */
export const crearContratoExternoHttp = async (
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

  if (!esObjeto(req.body)) {
    res.status(400).json({
      mensaje: 'El cuerpo de la solicitud es inválido.',
    });
    return;
  }

  const cuerpo = req.body;

  const camposPermitidos = new Set([
    'contratistaEmpresaId',
    'faenaId',
    'nombre',
    'numeroContrato',
    'contratoPrincipalId',
    'fechaInicio',
    'fechaTermino',
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

  const solicitud = {
    administradorId: usuario.id,
    contratistaEmpresaId: cuerpo.contratistaEmpresaId,
    faenaId: cuerpo.faenaId,
    nombre: cuerpo.nombre,
    numeroContrato: cuerpo.numeroContrato,
    contratoPrincipalId: cuerpo.contratoPrincipalId,
    fechaInicio: cuerpo.fechaInicio,
    fechaTermino: cuerpo.fechaTermino,
  } as SolicitudCrearContratoExterno;

  try {
    const contrato = await crearContratoExterno(solicitud);

    res.status(201).json({
      mensaje: 'Contrato externo creado correctamente.',
      contrato,
    });
  } catch (error) {
    if (
      error instanceof ErrorContratoExterno ||
      error instanceof ErrorAsignacionDocumental
    ) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al crear contrato externo:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible crear el contrato externo.',
    });
  }
};

/**
 * GET /api/contratos-externos
 *
 * Devuelve exclusivamente los contratos pertenecientes
 * a la empresa mandante del administrador autenticado.
 *
 * No recibe identificadores empresariales del frontend.
 */
export const obtenerContratosExternosHttp = async (
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

  try {
    const contratos = await obtenerContratosExternosMandante({
      administradorId: usuario.id,
    });

    res.status(200).json(contratos);
  } catch (error) {
    if (
      error instanceof ErrorConsultaContratosExternos ||
      error instanceof ErrorAsignacionDocumental
    ) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al consultar contratos externos:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible consultar los contratos externos.',
    });
  }
};
