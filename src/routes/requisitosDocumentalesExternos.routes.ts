import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import {
  ErrorPlantillaDocumental,
  recibirPlantillaDocumental,
  validarPlantillaDocumentalCompleta,
} from '../middlewares/plantillaDocumentalExterna';

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

const directorioPlantillas = path.resolve(
  __dirname, '../../../prisma-storage-privado/plantillas-externas'
);

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

    const esMultipart = Boolean(req.is('multipart/form-data'));
    let archivoEscrito: string | undefined;
    let consultaInsercionIniciada = false;
    let insercionConfirmada = false;

    try {
      // Mantener la autorización original basada en datos de MySQL.
      const mandanteId = await obtenerEmpresaAdministrador(usuarioId);

      if (esMultipart) {
        // Verificar el contrato antes de recibir los bytes del archivo.
        const contratos = await sequelize.query<{ id: number }>(
          [
            'SELECT c.id FROM contratos_externos c',
            'JOIN empresas m ON m.id = c.mandante_empresa_id AND m.activo = 1',
            'JOIN empresas e ON e.id = c.contratista_empresa_id AND e.activo = 1',
            'WHERE c.id = :contratoId AND c.mandante_empresa_id = :mandanteId',
            'LIMIT 1',
          ].join('\n'),
          {
            replacements: { contratoId, mandanteId },
            type: QueryTypes.SELECT,
          }
        );

        if (contratos.length !== 1) {
          res.status(404).json({
            mensaje: 'Contrato no disponible para esta mandante.',
          });
          return;
        }

        await new Promise<void>((resolve, reject) => {
          recibirPlantillaDocumental(req, res, error =>
            error ? reject(error) : resolve()
          );
        });
      }

      const cuerpo = req.body;

      if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo) ||
          Object.keys(cuerpo).some(campo => campo !== 'nombre') ||
          typeof cuerpo.nombre !== 'string') {
        res.status(400).json({
          mensaje: 'Ingresa solamente el nombre del documento solicitado.',
        });
        return;
      }

      const nombre = cuerpo.nombre.trim();

      if (!nombre || nombre.length > 255) {
        res.status(400).json({
          mensaje: 'El nombre debe tener entre 1 y 255 caracteres.',
        });
        return;
      }

      const archivo = esMultipart ? req.file : undefined;
      let plantillaUrl: string | null = null;
      let plantillaNombre: string | null = null;

      if (archivo) {
        const extension = await validarPlantillaDocumentalCompleta(archivo);
        const nombreInterno = randomUUID() + '.' + extension;

        await mkdir(directorioPlantillas, {
          recursive: true,
          mode: 0o700,
        });

        archivoEscrito = path.join(directorioPlantillas, nombreInterno);
        const destino = await open(archivoEscrito, 'wx', 0o600);

        try {
          await destino.writeFile(archivo.buffer);
        } finally {
          await destino.close();
        }

        plantillaUrl = 'privado:plantillas-externas/' + nombreInterno;
        plantillaNombre = archivo.originalname;
      }

      const columnas = archivo
        ? '  (contrato_id, nombre, destinatario, obligatorio, periodicidad, activo, plantilla_archivo_url, plantilla_nombre_original)'
        : '  (contrato_id, nombre, destinatario, obligatorio, periodicidad, activo)';

      const valores = archivo
        ? "SELECT c.id, :nombre, 'empresa', 1, 'unica', 1, :plantillaUrl, :plantillaNombre"
        : "SELECT c.id, :nombre, 'empresa', 1, 'unica', 1";

      const replacements = archivo
        ? { nombre, contratoId, mandanteId, plantillaUrl, plantillaNombre }
        : { nombre, contratoId, mandanteId };

      consultaInsercionIniciada = true;

      const [requisitoId, filas] = await sequelize.query(
        [
          'INSERT INTO requisitos_documentales_externos',
          columnas,
          valores,
          'FROM contratos_externos c',
          'JOIN empresas m ON m.id = c.mandante_empresa_id AND m.activo = 1',
          'JOIN empresas e ON e.id = c.contratista_empresa_id AND e.activo = 1',
          'WHERE c.id = :contratoId AND c.mandante_empresa_id = :mandanteId',
        ].join('\n'),
        {
          replacements,
          type: QueryTypes.INSERT,
        }
      );

      if (filas !== 1) {
        // No hubo inserción: limpiar el archivo creado.
        consultaInsercionIniciada = false;
        throw new ErrorPlantillaDocumental(
          404,
          'Contrato no disponible para esta mandante.'
        );
      }

      insercionConfirmada = true;

      res.status(201).json({
        id: requisitoId,
        contratoId,
        nombre,
        ...(archivo ? { tienePlantilla: true } : {}),
      });
    } catch (error) {
      // Si una consulta INSERT produjo un resultado incierto, conservar
      // el archivo para evitar eliminar un documento ya referenciado.
      if (archivoEscrito &&
          !insercionConfirmada &&
          !consultaInsercionIniciada) {
        await unlink(archivoEscrito).catch(errorLimpieza => {
          console.error('No se pudo limpiar la plantilla:', errorLimpieza);
        });
      }

      if (error instanceof multer.MulterError) {
        res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          mensaje: error.code === 'LIMIT_FILE_SIZE'
            ? 'El archivo no puede superar los 10 MB.'
            : 'Adjunta como máximo un archivo en el campo archivo.',
        });
        return;
      }

      if (error instanceof ErrorPlantillaDocumental ||
          error instanceof ErrorAsignacionDocumental) {
        res.status(error.estadoHttp).json({ mensaje: error.message });
        return;
      }

      console.error('Error al crear requisito documental externo:', error);
      res.status(500).json({
        mensaje: 'No fue posible crear la solicitud documental.',
      });
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
          '       CASE WHEN r.plantilla_archivo_url IS NOT NULL',
          '            THEN 1 ELSE 0 END AS tienePlantilla,',
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

router.get(
  '/entregas-por-resolver',
  validarToken,
  esAdministrador,
  async (req, res): Promise<void> => {
    const usuarioId = (req as RequestConUsuario).usuario?.id;

    if (typeof usuarioId !== 'number' ||
        !Number.isSafeInteger(usuarioId) ||
        usuarioId <= 0) {
      res.status(401).json({ mensaje: 'Administrador no autenticado.' });
      return;
    }

    if (Object.keys(req.query).length > 0) {
      res.status(400).json({ mensaje: 'Esta consulta no admite parámetros.' });
      return;
    }

    try {
      const mandanteId = await obtenerEmpresaAdministrador(usuarioId);

      const [resumen] = await sequelize.query<{ total: number | string }>(
        [
          'SELECT COUNT(*) AS total',
          'FROM contratos_externos c',
          'JOIN empresas m ON m.id = c.mandante_empresa_id AND m.activo = 1',
          'JOIN empresas e ON e.id = c.contratista_empresa_id AND e.activo = 1',
          'JOIN requisitos_documentales_externos r ON r.contrato_id = c.id',
          'JOIN acreditaciones_documentales_externas a ON a.id = (',
          '  SELECT ultima.id',
          '  FROM acreditaciones_documentales_externas ultima',
          '  WHERE ultima.contrato_id = c.id AND ultima.requisito_id = r.id',
          '    AND ultima.contrato_trabajador_id IS NULL',
          '  ORDER BY ultima.fecha_presentacion DESC, ultima.id DESC',
          '  LIMIT 1',
          ')',
          'WHERE c.mandante_empresa_id = :mandanteId',
          "  AND r.activo = 1 AND r.destinatario = 'empresa'",
          "  AND a.estado IN ('pendiente', 'en_revision')",
        ].join('\n'),
        {
          replacements: { mandanteId },
          type: QueryTypes.SELECT,
        }
      );

      const total = Number(resumen?.total);
      if (!Number.isSafeInteger(total) || total < 0) {
        throw new Error('El total de entregas por resolver es inválido.');
      }

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ total });
    } catch (error) {
      if (error instanceof ErrorAsignacionDocumental) {
        res.status(error.estadoHttp).json({ mensaje: error.message });
        return;
      }

      console.error('Error al contar entregas externas por resolver:', error);
      res.status(500).json({ mensaje: 'No fue posible consultar el total de entregas por resolver.' });
    }
  }
);

export default router;
