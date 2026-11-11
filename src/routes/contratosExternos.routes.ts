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

import {
  registrarAcreditacionExternaHttp,
} from '../controllers/acreditacionesExternas.controller';

import {
  revisarAcreditacionExternaHttp,
} from '../controllers/revisionAcreditacionesExternas.controller';

import {
  consultarAcreditacionesExternasHttp,
} from '../controllers/consultaAcreditacionesExternas.controller';

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
 */
router.post(
  '/:contratoId/trabajadores',
  validarToken,
  vincularTrabajadorContratoExternoHttp
);

/**
 * POST /api/contratos-externos/:contratoId/acreditaciones
 *
 * Registra la presentación documental externa.
 *
 * La autorización empresarial y documental se verifica
 * mediante los servicios de negocio.
 */
router.post(
  '/:contratoId/acreditaciones',
  validarToken,
  registrarAcreditacionExternaHttp
);

/**
 * GET /api/contratos-externos/:contratoId/acreditaciones
 *
 * Consulta las acreditaciones documentales de un contrato.
 *
 * Permite administradores autorizados de la mandante
 * o de la contratista.
 *
 * Aplica paginación y aislamiento multiempresa.
 */
router.get(
  '/:contratoId/acreditaciones',
  validarToken,
  consultarAcreditacionesExternasHttp
);

/**
 * PATCH /api/contratos-externos/acreditaciones/:acreditacionId/revision
 *
 * Permite iniciar, aprobar o rechazar
 * una revisión documental externa.
 *
 * El servicio verifica la autorización de la mandante
 * y protege las transiciones de estado.
 */
router.patch(
  '/acreditaciones/:acreditacionId/revision',
  validarToken,
  revisarAcreditacionExternaHttp
);

export default router;
