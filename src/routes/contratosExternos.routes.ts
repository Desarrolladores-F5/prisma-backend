// src/routes/contratosExternos.routes.ts

import { Router } from 'express';

import {
  validarToken,
  esAdministrador,
} from '../middlewares/validarToken';

import {
  crearContratoExternoHttp,
  obtenerContratosExternosHttp,
} from '../controllers/contratosExternos.controller';

import {
  vincularTrabajadorContratoExternoHttp,
} from '../controllers/trabajadoresContratosExternos.controller';

const router = Router();

/**
 * GET /api/contratos-externos
 *
 * Consulta los contratos de la empresa mandante
 * del administrador autenticado.
 */
router.get(
  '/',
  validarToken,
  esAdministrador,
  obtenerContratosExternosHttp
);

/**
 * POST /api/contratos-externos
 *
 * Crea un contrato externo para la empresa mandante
 * del administrador autenticado.
 */
router.post(
  '/',
  validarToken,
  esAdministrador,
  crearContratoExternoHttp
);

/**
 * POST /api/contratos-externos/:contratoId/trabajadores
 *
 * Vincula un trabajador a un contrato externo.
 *
 * La autorización del administrador externo se verifica
 * directamente en MySQL mediante el servicio de negocio.
 *
 * No se exige rol_id = 1 porque el administrador externo
 * utiliza una vinculación empresarial específica.
 */
router.post(
  '/:contratoId/trabajadores',
  validarToken,
  vincularTrabajadorContratoExternoHttp
);

export default router;
