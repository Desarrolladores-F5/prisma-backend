// src/routes/rel_documentos_usuarios.routes.ts
import { Router } from 'express';
import {
  asignarDocumentoAUsuario,
  obtenerDocumentosPorUsuario,
  eliminarAsignacionDocumentoUsuario,
  obtenerConfirmacionesPorDocumento,
  confirmarRecepcion,
  descargarConstancia,
} from '../controllers/rel_documentos_usuarios.controller';
import { validarToken } from '../middlewares/validarToken';
import { esAdministrador } from '../middlewares/autorizarRol';

const router = Router();

// Asignar documento (solo admin)
router.post('/', validarToken, esAdministrador, asignarDocumentoAUsuario);

// 🔒 Descargar constancia documental con autorización
router.get('/constancias/:id', validarToken, descargarConstancia);

// Obtener documentos asignados por usuario
router.get('/:usuario_id', validarToken, obtenerDocumentosPorUsuario);

// Confirmar recepción de documento (trabajador autenticado)
router.patch('/confirmar/:documento_id', validarToken, confirmarRecepcion);

// Obtener confirmaciones por documento (solo admin)
router.get('/documento/:id/confirmaciones', validarToken, esAdministrador, obtenerConfirmacionesPorDocumento);

// Eliminar asignación
router.delete('/:id', validarToken, esAdministrador, eliminarAsignacionDocumentoUsuario);

export default router;
