// src/routes/empresasExternas.routes.ts

import { Router } from 'express';

import {
  validarToken,
} from '../middlewares/validarToken';

import {
  consultarMisEmpresasExternasHttp,
} from '../controllers/misEmpresasExternas.controller';

const router = Router();

/**
 * GET /api/empresas-externas/mis-empresas
 *
 * La identidad proviene exclusivamente del JWT verificado.
 * El servicio comprueba las vinculaciones empresariales vigentes.
 */
router.get(
  '/mis-empresas',
  validarToken,
  consultarMisEmpresasExternasHttp
);

export default router;
