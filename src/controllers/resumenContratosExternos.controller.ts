// src/controllers/resumenContratosExternos.controller.ts

import type { Request, Response } from 'express';

import type {
  RequestConUsuario,
} from '../middlewares/validarToken';

import {
  obtenerResumenContratosExternos,
  ErrorResumenContratosExternos,
} from '../services/resumenContratosExternos.service';

import {
  obtenerEntregasPorResolverContrato,
} from '../services/entregasPorResolverContrato.service';

import {
  ErrorAsignacionDocumental,
} from '../services/asignacionDocumental.service';

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * GET /api/contratos-externos/resumen-documental
 *
 * Listado administrativo de contratistas y subcontratistas,
 * incluyendo la cantidad de entregas documentales por resolver.
 *
 * Seguridad:
 * - El administrador se identifica mediante el JWT verificado.
 * - Ambos servicios determinan la mandante desde MySQL.
 * - No se reciben identificadores empresariales del frontend.
 * - Los contadores se incorporan únicamente a contratos autorizados.
 *
 * No modifica contratos ni documentos.
 */
export const obtenerResumenContratosExternosHttp = async (
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
    const contratos = await obtenerResumenContratosExternos({
      administradorId: usuario.id,
    });

    const entregas = await obtenerEntregasPorResolverContrato(
      usuario.id
    );

    const pendientesPorContrato = new Map<number, number>();

    for (const entrega of entregas) {
      if (
        !idValido(entrega.contrato_id) ||
        !Number.isSafeInteger(entrega.total) ||
        entrega.total < 0
      ) {
        throw new Error(
          'El contador documental contiene valores inválidos.'
        );
      }

      if (pendientesPorContrato.has(entrega.contrato_id)) {
        throw new Error(
          'El contador documental contiene contratos duplicados.'
        );
      }

      pendientesPorContrato.set(
        entrega.contrato_id,
        entrega.total
      );
    }

    const resultado = contratos.map(contrato => ({
      ...contrato,
      entregas_por_resolver:
        pendientesPorContrato.get(contrato.id) ?? 0,
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(resultado);
  } catch (error) {
    if (
      error instanceof ErrorResumenContratosExternos ||
      error instanceof ErrorAsignacionDocumental
    ) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al consultar resumen de contratos externos:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible consultar el resumen de contratos externos.',
    });
  }
};
