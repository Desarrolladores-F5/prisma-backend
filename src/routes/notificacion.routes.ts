// src/routes/notificacion.routes.ts
import { Router } from 'express';
import {
  obtenerNotificaciones,
  obtenerMisNotificaciones,
  crearNotificacion,
  actualizarNotificacion,
  eliminarNotificacion,
  marcarComoLeida
} from '../controllers/notificacion.controller';

import { validarToken } from '../middlewares/validarToken';
import { esAdministrador } from '../middlewares/roles';
import { autorizarRol } from '../middlewares/autorizarRol';

const router = Router();

// 🔹 Administrador y Supervisor: Obtener todas las notificaciones activas
router.get('/', validarToken, autorizarRol(1, 2), obtenerNotificaciones);

// 🔹 Trabajador: Obtener solo sus notificaciones personales
router.get('/mis-notificaciones', validarToken, obtenerMisNotificaciones);

// 🔹 Trabajador: Marcar notificación como leída
router.put('/:id/leido', validarToken, marcarComoLeida);

// 🔐 Solo Administrador puede crear, actualizar y eliminar notificaciones
router.post('/', validarToken, esAdministrador, crearNotificacion);
router.put('/:id', validarToken, esAdministrador, actualizarNotificacion);
router.delete('/:id', validarToken, esAdministrador, eliminarNotificacion);

export default router;
