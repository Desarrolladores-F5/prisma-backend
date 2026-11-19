import { Router } from 'express';
import { QueryTypes } from 'sequelize';

import {
  esAdministrador,
  validarToken,
  validarTokenExternoPermitido,
  type RequestConUsuario,
} from '../middlewares/validarToken';
import { sequelize } from '../models';
import {
  ErrorAsignacionDocumental,
  obtenerEmpresaAdministrador,
} from '../services/asignacionDocumental.service';

const router = Router();

router.post(
  '/:contratoId/requisitos',
  validarToken,
  esAdministrador,
  async (req, res): Promise<void> => {
    const usuarioId = (req as RequestConUsuario).usuario?.id;
    const contratoParam = req.params.contratoId;
    const contratoId = Number(contratoParam);

    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    if (typeof contratoParam !== 'string' ||
        !/^[1-9]\d*$/.test(contratoParam) ||
        !Number.isSafeInteger(contratoId)) {
      res.status(400).json({ mensaje: 'Identificador de contrato inválido.' });
      return;
    }

    const cuerpo = req.body;
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo) ||
        Object.keys(cuerpo).some(campo => campo !== 'nombre') ||
        typeof cuerpo.nombre !== 'string') {
      res.status(400).json({ mensaje: 'Ingresa solamente el nombre del documento solicitado.' });
      return;
    }

    const nombre = cuerpo.nombre.trim();
    if (!nombre || nombre.length > 255) {
      res.status(400).json({ mensaje: 'El nombre debe tener entre 1 y 255 caracteres.' });
      return;
    }

    try {
      const mandanteId = await obtenerEmpresaAdministrador(usuarioId);
      const [requisitoId, filas] = await sequelize.query(
        [
          'INSERT INTO requisitos_documentales_externos',
          '  (contrato_id, nombre, destinatario, obligatorio, periodicidad, activo)',
          "SELECT c.id, :nombre, 'empresa', 1, 'unica', 1",
          'FROM contratos_externos c',
          'JOIN empresas m ON m.id = c.mandante_empresa_id AND m.activo = 1',
          'JOIN empresas e ON e.id = c.contratista_empresa_id AND e.activo = 1',
          'WHERE c.id = :contratoId AND c.mandante_empresa_id = :mandanteId',
        ].join('\n'),
        {
          replacements: { nombre, contratoId, mandanteId },
          type: QueryTypes.INSERT,
        }
      );

      if (filas !== 1) {
        res.status(404).json({ mensaje: 'Contrato no disponible para esta mandante.' });
        return;
      }

      res.status(201).json({ id: requisitoId, contratoId, nombre });
    } catch (error) {
      if (error instanceof ErrorAsignacionDocumental) {
        res.status(error.estadoHttp).json({ mensaje: error.message });
        return;
      }

      console.error('Error al crear requisito documental externo:', error);
      res.status(500).json({ mensaje: 'No fue posible crear la solicitud documental.' });
    }
  }
);


router.get(
  '/mis-requisitos',
  validarTokenExternoPermitido,
  async (req, res): Promise<void> => {
    const usuarioId = (req as RequestConUsuario).usuario?.id;

    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
      res.status(401).json({ mensaje: 'Usuario no autenticado.' });
      return;
    }

    if (Object.keys(req.query).length > 0) {
      res.status(400).json({ mensaje: 'Esta consulta no admite parámetros.' });
      return;
    }

    try {
      const solicitudes = await sequelize.query(
        [
          'SELECT r.id, r.contrato_id AS contratoId, r.nombre,',
          '       e.id AS empresaId, m.nombre AS mandante,',
          '       a.id AS acreditacionId,',
          "       COALESCE(a.estado, 'pendiente_carga') AS estado,",
          '       a.observaciones, a.fecha_presentacion AS fechaPresentacion,',
          '       a.fecha_revision AS fechaRevision',
          'FROM usuarios u',
          'JOIN usuarios_empresas_externas v ON v.usuario_id = u.id',
          'JOIN empresas e ON e.id = v.empresa_id AND e.activo = 1',
          'JOIN contratos_externos c ON c.contratista_empresa_id = e.id',
          'JOIN empresas m ON m.id = c.mandante_empresa_id AND m.activo = 1',
          'JOIN requisitos_documentales_externos r ON r.contrato_id = c.id',
          'LEFT JOIN acreditaciones_documentales_externas a ON a.id = (',
          '  SELECT ultima.id',
          '  FROM acreditaciones_documentales_externas ultima',
          '  WHERE ultima.contrato_id = c.id AND ultima.requisito_id = r.id',
          '    AND ultima.contrato_trabajador_id IS NULL',
          '  ORDER BY ultima.fecha_presentacion DESC, ultima.id DESC',
          '  LIMIT 1',
          ')',
          'WHERE u.id = :usuarioId AND u.activo = 1',
          "  AND v.activo = 1 AND v.perfil = 'administrador_externo'",
          "  AND r.activo = 1 AND r.destinatario = 'empresa'",
          'ORDER BY r.id DESC',
        ].join('\n'),
        {
          replacements: { usuarioId },
          type: QueryTypes.SELECT,
        }
      );

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ solicitudes });
    } catch (error) {
      console.error('Error al consultar solicitudes documentales externas:', error);
      res.status(500).json({
        mensaje: 'No fue posible consultar las solicitudes documentales.',
      });
    }
  }
);

export default router;
