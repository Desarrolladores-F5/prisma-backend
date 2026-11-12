// src/controllers/misEmpresasExternas.controller.ts

import type { Request, Response } from 'express';

import type {
  RequestConUsuario,
} from '../middlewares/validarToken';

import {
  obtenerMisEmpresasExternas,
  ErrorConsultaMisEmpresasExternas,
} from '../services/misEmpresasExternas.service';

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * GET /api/empresas-externas/mis-empresas
 *
 * Consulta las empresas externas vinculadas al usuario autenticado.
 *
 * Seguridad:
 * - La identidad proviene exclusivamente del JWT verificado.
 * - No admite parámetros para consultar otros usuarios.
 * - El servicio valida el estado del usuario, sus vinculaciones
 *   y las empresas correspondientes.
 * - Esta consulta no concede permisos administrativos.
 */
export const consultarMisEmpresasExternasHttp = async (
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

  if (
    Object.keys(req.query).length > 0 ||
    Object.keys(req.body ?? {}).length > 0
  ) {
    res.status(400).json({
      mensaje: 'La consulta no admite parámetros.',
    });
    return;
  }

  try {
    const resultado = await obtenerMisEmpresasExternas(
      usuario.id
    );

    res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof ErrorConsultaMisEmpresasExternas) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error(
      'Error interno al consultar empresas externas:',
      error
    );

    res.status(500).json({
      mensaje: 'No fue posible consultar las empresas externas.',
    });
  }
};
