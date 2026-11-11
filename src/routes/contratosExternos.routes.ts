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

/**
 * POST /api/contratos-externos/:contratoId/acreditaciones
 *
 * Presenta una acreditación documental externa.
 *
 * La identidad se obtiene exclusivamente del JWT.
 * La autorización empresarial y documental se comprueba
 * mediante los servicios de negocio.
 *
 * Las presentaciones comienzan en estado pendiente.
 */
router.post(
  '/:contratoId/acreditaciones',
  validarToken,
  registrarAcreditacionExternaHttp
);

/**
 * PATCH /api/contratos-externos/acreditaciones/:acreditacionId/revision
 *
 * Permite iniciar, aprobar o rechazar una revisión documental.
 *
 * La identidad proviene del JWT.
 * El servicio verifica en MySQL que el administrador
 * pertenezca a la empresa mandante del contrato.
 *
 * Las transiciones de estado están protegidas
 * mediante transacciones y actualizaciones condicionales.
 */
router.patch(
  '/acreditaciones/:acreditacionId/revision',
  validarToken,
  revisarAcreditacionExternaHttp
);

export default router;
