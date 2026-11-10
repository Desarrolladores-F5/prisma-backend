// src/routes/contratosExternos.routes.ts

import { Router } from 'express';

import {
  validarToken,
  esAdministrador,
} from '../middlewares/validarToken';

import {
  crearContratoExternoHttp,
} from '../controllers/contratosExternos.controller';

const router = Router();

/**
 * POST /api/contratos-externos
 *
 * Permite crear un contrato externo a un administrador
 * de la empresa mandante.
 *
 * La identidad procede del JWT.
 * La pertenencia empresarial y los permisos vigentes
 * se verifican mediante el servicio de negocio.
 */
router.post(
  '/',
  validarToken,
  esAdministrador,
  crearContratoExternoHttp
);

export default router;
