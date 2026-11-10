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

const router = Router();

/**
 * GET /api/contratos-externos
 *
 * Consulta los contratos pertenecientes a la empresa
 * mandante del administrador autenticado.
 *
 * La empresa se determina desde MySQL,
 * nunca desde parámetros enviados por el frontend.
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
 *
 * Los permisos vigentes y la pertenencia empresarial
 * se verifican mediante el servicio de negocio.
 */
router.post(
  '/',
  validarToken,
  esAdministrador,
  crearContratoExternoHttp
);

export default router;
