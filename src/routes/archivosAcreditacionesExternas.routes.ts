import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { QueryTypes } from 'sequelize';

import { validarToken, validarTokenExternoPermitido, type RequestConUsuario } from '../middlewares/validarToken';
import { Documento, sequelize } from '../models';
import {
  autorizarAdministradorContratoExterno,
  ErrorAutorizacionEmpresaExterna,
} from '../services/autorizacionEmpresasExternas.service';
import {
  ErrorPresentacionDocumentalExterna,
} from '../services/autorizacionPresentacionDocumentalExterna.service';
import {
  registrarAcreditacionDocumentalExterna,
  ErrorRegistroAcreditacionExterna,
} from '../services/registroAcreditacionDocumentalExterna.service';

import {
  autorizarRevisionDocumentalExterna,
  ErrorAutorizacionRevisionExterna,
} from '../services/autorizacionRevisionDocumentalExterna.service';
import { ErrorAsignacionDocumental } from '../services/asignacionDocumental.service';

import { crearNotificacionesAutomaticas } from '../services/notificacionesAutomaticas.service';

const router = Router();
const directorioPrivado = path.resolve(
  __dirname, '../../../prisma-storage-privado/acreditaciones-externas'
);

const recibirPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
}).single('archivo');

class ErrorCargaPrivada extends Error {
  constructor(public readonly estadoHttp: number, mensaje: string) {
    super(mensaje);
  }
}

function idRuta(valor: unknown): number | null {
  if (typeof valor !== 'string' || !/^[1-9]\d*$/.test(valor)) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) ? id : null;
}

router.post(
  '/:contratoId/requisitos/:requisitoId/archivo',
  validarTokenExternoPermitido,
  async (req, res): Promise<void> => {
    const usuarioId = (req as RequestConUsuario).usuario?.id;
    const contratoId = idRuta(req.params.contratoId);
    const requisitoId = idRuta(req.params.requisitoId);

    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
      res.status(401).json({ mensaje: 'Usuario no autenticado.' });
      return;
    }

    if (contratoId === null || requisitoId === null) {
      res.status(400).json({ mensaje: 'Contrato o solicitud inválidos.' });
      return;
    }

    let archivoEscrito: string | undefined;
    let listaParaConfirmar = false;

    try {
      // Validar la vinculación antes de leer el archivo del navegador.
      await autorizarAdministradorContratoExterno(usuarioId, contratoId);

      await new Promise<void>((resolve, reject) => {
        recibirPdf(req, res, error => error ? reject(error) : resolve());
      });

      const archivo = req.file;
      if (!archivo ||
          !/\.pdf$/i.test(archivo.originalname) ||
          archivo.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new ErrorCargaPrivada(400, 'Adjunta un archivo PDF.');
      }

      const entrega = await sequelize.transaction(async transaction => {
        const autorizacion = await autorizarAdministradorContratoExterno(
          usuarioId, contratoId, { transaction }
        );

        // Serializar cargas de una misma solicitud antes de comprobar su estado.
        const [requisito] = await sequelize.query<{ nombre: string; faenaId: number }>(
          [
            'SELECT r.nombre, c.faena_id AS faenaId',
            'FROM requisitos_documentales_externos r',
            'JOIN contratos_externos c ON c.id = r.contrato_id',
            'JOIN empresas m ON m.id = c.mandante_empresa_id AND m.activo = 1',
            'JOIN empresas e ON e.id = c.contratista_empresa_id AND e.activo = 1',
            'WHERE r.id = :requisitoId AND c.id = :contratoId',
            '  AND c.contratista_empresa_id = :empresaId',
            "  AND c.estado IN ('pendiente', 'activo')",
            "  AND r.activo = 1 AND r.destinatario = 'empresa'",
            'FOR UPDATE',
          ].join('\n'),
          {
            replacements: { requisitoId, contratoId, empresaId: autorizacion.empresaId },
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        if (!requisito) {
          throw new ErrorCargaPrivada(404, 'La solicitud no está disponible para esta empresa.');
        }

        const [ultima] = await sequelize.query<{ estado: string }>(
          [
            'SELECT estado FROM acreditaciones_documentales_externas',
            'WHERE requisito_id = :requisitoId AND contrato_id = :contratoId',
            '  AND contrato_trabajador_id IS NULL',
            'ORDER BY fecha_presentacion DESC, id DESC',
            'LIMIT 1 FOR UPDATE',
          ].join('\n'),
          {
            replacements: { requisitoId, contratoId },
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        if (ultima && ultima.estado !== 'rechazado') {
          throw new ErrorCargaPrivada(409, 'La solicitud ya tiene una entrega que no admite reemplazo.');
        }

        const nombreArchivo = randomUUID() + '.pdf';
        await mkdir(directorioPrivado, { recursive: true, mode: 0o700 });
        const destino = path.join(directorioPrivado, nombreArchivo);
        const salida = await open(destino, 'wx', 0o600);
        archivoEscrito = destino;
        try {
          await salida.writeFile(archivo.buffer);
        } finally {
          await salida.close();
        }

        const documento = await Documento.create({
          nombre: requisito.nombre,
          tipo: 'acreditacion_externa',
          url: 'privado:acreditaciones/' + nombreArchivo,
          version: '1.0',
          empresa_id: autorizacion.empresaId,
        }, { transaction });

        const acreditacion = await registrarAcreditacionDocumentalExterna({
          administradorId: usuarioId,
          contratoId,
          requisitoId,
          documentoId: documento.get('id'),
          transaction,
        });

        await crearNotificacionesAutomaticas({
          mensaje: 'Nueva entrega documental externa para «' +
            requisito.nombre + '». Está pendiente de revisión.',
          tipo: 'entrega_documental_externa',
          origen: 'acreditaciones_externas',
          claveEvento: 'acreditacion_externa:entrega:' + acreditacion.get('id'),
          roles: [1],
          faenaId: Number(requisito.faenaId),
          agregarUsuarioIdClave: true,
          transaction,
        });

        listaParaConfirmar = true;
        return acreditacion;
      });

      res.status(201).json({
        acreditacionId: entrega.get('id'),
        estado: 'pendiente',
      });
    } catch (error) {
      // Si falla la confirmación, su resultado puede ser incierto.
      // En ese caso no borrar un PDF que podría tener un registro confirmado.
      if (archivoEscrito && !listaParaConfirmar) {
        await unlink(archivoEscrito).catch(errorLimpieza => {
          console.error('No se pudo limpiar el PDF de una entrega fallida:', errorLimpieza);
        });
      }

      if (error instanceof multer.MulterError) {
        const excedeLimite = error.code === 'LIMIT_FILE_SIZE';
        res.status(excedeLimite ? 413 : 400).json({
          mensaje: excedeLimite
            ? 'El PDF no puede superar los 10 MB.'
            : 'Adjunta un solo PDF en el campo archivo.',
        });
        return;
      }

      if (error instanceof ErrorCargaPrivada ||
          error instanceof ErrorAutorizacionEmpresaExterna ||
          error instanceof ErrorPresentacionDocumentalExterna ||
          error instanceof ErrorRegistroAcreditacionExterna) {
        res.status(error.estadoHttp).json({ mensaje: error.message });
        return;
      }

      console.error('Error al registrar la entrega privada:', error);
      res.status(500).json({ mensaje: 'No fue posible confirmar la entrega del PDF.' });
    }
  }
);


router.get(
  '/acreditaciones/:acreditacionId/archivo',
  validarToken,
  async (req, res): Promise<void> => {
    const usuarioId = (req as RequestConUsuario).usuario?.id;
    const acreditacionId = idRuta(req.params.acreditacionId);

    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) {
      res.status(401).json({ mensaje: 'Usuario no autenticado.' });
      return;
    }

    if (acreditacionId === null) {
      res.status(400).json({ mensaje: 'Identificador de acreditación inválido.' });
      return;
    }

    try {
      const permisos = await autorizarRevisionDocumentalExterna({
        administradorId: usuarioId,
        acreditacionId,
      });

      const [documento] = await sequelize.query<{ url: string }>(
        [
          'SELECT d.url',
          'FROM acreditaciones_documentales_externas a',
          'JOIN contratos_externos c ON c.id = a.contrato_id',
          'JOIN documentos d ON d.id = a.documento_id',
          'WHERE a.id = :acreditacionId',
          '  AND c.id = :contratoId',
          '  AND c.mandante_empresa_id = :mandanteEmpresaId',
          '  AND d.empresa_id = c.contratista_empresa_id',
          "  AND d.tipo = 'acreditacion_externa'",
          'LIMIT 1',
        ].join('\n'),
        {
          replacements: {
            acreditacionId,
            contratoId: permisos.contratoId,
            mandanteEmpresaId: permisos.mandanteEmpresaId,
          },
          type: QueryTypes.SELECT,
        }
      );

      const coincidencia =
        /^privado:acreditaciones\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf)$/
          .exec(documento?.url ?? '');

      if (!coincidencia) {
        res.status(404).json({ mensaje: 'No hay un PDF privado disponible para esta entrega.' });
        return;
      }

      let pdf: Buffer;
      try {
        pdf = await readFile(path.join(directorioPrivado, coincidencia[1]));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          res.status(404).json({ mensaje: 'El PDF de esta entrega no está disponible.' });
          return;
        }
        throw error;
      }

      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.attachment('acreditacion-' + acreditacionId + '.pdf');
      res.type('application/pdf').status(200).send(pdf);
    } catch (error) {
      if (error instanceof ErrorAutorizacionRevisionExterna ||
          error instanceof ErrorAsignacionDocumental) {
        res.status(error.estadoHttp).json({ mensaje: error.message });
        return;
      }

      console.error('Error al descargar PDF privado de acreditación:', error);
      res.status(500).json({ mensaje: 'No fue posible descargar el PDF.' });
    }
  }
);

export default router;
