// src/controllers/consultaAcreditacionesExternas.controller.ts

import type { Request, Response } from 'express';

import type {
  RequestConUsuario,
} from '../middlewares/validarToken';

import {
  obtenerAcreditacionesExternasContrato,
  ErrorConsultaAcreditacionesExternas,
} from '../services/consultaAcreditacionesExternas.service';

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

const obtenerIdRuta = (valor: unknown): number | null => {
  if (
    typeof valor !== 'string' ||
    !/^[1-9]\d*$/.test(valor)
  ) {
    return null;
  }

  const numero = Number(valor);

  return idValido(numero) ? numero : null;
};

const obtenerEnteroConsulta = (
  valor: unknown,
  predeterminado: number
): number | null => {
  if (valor === undefined) {
    return predeterminado;
  }

  if (
    typeof valor !== 'string' ||
    !/^[1-9]\d*$/.test(valor)
  ) {
    return null;
  }

  const numero = Number(valor);

  return idValido(numero) ? numero : null;
};

/**
 * GET /api/contratos-externos/:contratoId/acreditaciones
 *
 * Consulta paginada de acreditaciones documentales.
 *
 * La identidad proviene exclusivamente del JWT.
 * El contrato se identifica desde la ruta.
 * El servicio verifica la autorización multiempresa.
 *
 * No acepta identificadores empresariales del cliente.
 */
export const consultarAcreditacionesExternasHttp = async (
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

  const contratoId = obtenerIdRuta(req.params.contratoId);

  if (contratoId === null) {
    res.status(400).json({
      mensaje: 'Identificador de contrato inválido.',
    });
    return;
  }

  const camposConsultaPermitidos = new Set([
    'pagina',
    'limite',
  ]);

  if (
    Object.keys(req.query).some(
      campo => !camposConsultaPermitidos.has(campo)
    )
  ) {
    res.status(400).json({
      mensaje: 'La consulta contiene parámetros no permitidos.',
    });
    return;
  }

  const pagina = obtenerEnteroConsulta(
    req.query.pagina,
    1
  );

  const limite = obtenerEnteroConsulta(
    req.query.limite,
    20
  );

  if (
    pagina === null ||
    limite === null ||
    limite > 100 ||
    !Number.isSafeInteger((pagina - 1) * limite)
  ) {
    res.status(400).json({
      mensaje: 'Parámetros de paginación inválidos.',
    });
    return;
  }

  try {
    const resultado =
      await obtenerAcreditacionesExternasContrato({
        usuarioId: usuario.id,
        contratoId,
        pagina,
        limite,
      });

    res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof ErrorConsultaAcreditacionesExternas) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al consultar acreditaciones externas:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible consultar las acreditaciones documentales.',
    });
  }
};
