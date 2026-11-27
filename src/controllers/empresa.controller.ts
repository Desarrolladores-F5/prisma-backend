// src/controllers/empresa.controller.ts

import { Request, Response } from 'express';
import { Empresa } from '../models';
import type { RequestConUsuario } from '../middlewares/validarToken';

import {
  obtenerEmpresaUsuarioInterno,
  obtenerEmpresaAdministradorUsuarios,
  ErrorAutorizacionUsuarioInterno,
} from '../services/autorizacionUsuariosInternos.service';

/**
 * Lista únicamente la empresa interna del usuario autenticado.
 *
 * Seguridad:
 * - El identificador del usuario proviene del JWT verificado.
 * - La autorización y empresa se comprueban con datos vigentes.
 * - No se permite enumerar empresas ajenas.
 * - Solo se devuelve la empresa activa.
 * - Se conserva el formato de arreglo para compatibilidad.
 */
export const obtenerEmpresas = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaUsuarioInterno(
      req.usuario?.id
    );

    const empresas = await Empresa.findAll({
      where: {
        id: empresaId,
        activo: true,
      },
    });

    res.json(empresas);
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al obtener empresas:', error);

    res.status(500).json({
      mensaje: 'Error interno al obtener empresas.',
    });
  }
};

/**
 * La creación global de empresas está deshabilitada hasta contar
 * con un mecanismo explícito de autorización administrativa global.
 *
 * Ser administrador de una empresa cliente no concede permisos
 * para registrar nuevas organizaciones en PRISMA.
 */
export const crearEmpresa = async (
  _req: Request,
  res: Response
): Promise<void> => {
  res.status(403).json({
    mensaje: 'No autorizado para crear empresas.',
  });
};

/**
 * Actualiza únicamente los datos autorizados de la empresa propia.
 *
 * Seguridad:
 * - Comprueba el administrador vigente en MySQL.
 * - Rechaza modificaciones de empresas ajenas.
 * - Solo permite actualizar empresas activas.
 * - Utiliza una lista blanca de campos.
 * - Nunca permite modificar id, activo o fecha_creacion.
 */
export const actualizarEmpresa = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const idSolicitado = Number(req.params.id);

    if (
      !Number.isSafeInteger(idSolicitado) ||
      idSolicitado <= 0
    ) {
      res.status(400).json({
        mensaje: 'Identificador de empresa inválido.',
      });
      return;
    }

    if (idSolicitado !== empresaId) {
      res.status(403).json({
        mensaje: 'No autorizado para modificar esta empresa.',
      });
      return;
    }

    const body = req.body;

    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      res.status(400).json({
        mensaje: 'Datos de empresa inválidos.',
      });
      return;
    }

    const camposPermitidos = [
      'nombre',
      'rut',
      'razon_social',
      'direccion',
      'telefono',
      'correo',
      'representante_legal',
      'rubro',
    ] as const;

    const datos: Record<string, string | null> = {};

    for (const campo of camposPermitidos) {
      if (
        Object.prototype.hasOwnProperty.call(body, campo)
      ) {
        const valor = body[campo];

        if (
          valor !== null &&
          typeof valor !== 'string'
        ) {
          res.status(400).json({
            mensaje: 'Tipo de dato inválido para ' + campo + '.',
          });
          return;
        }

        datos[campo] = valor;
      }
    }

    if (Object.keys(datos).length === 0) {
      res.status(400).json({
        mensaje: 'No se proporcionaron campos modificables.',
      });
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(datos, 'nombre') &&
      (
        datos.nombre === null ||
        datos.nombre.trim() === ''
      )
    ) {
      res.status(400).json({
        mensaje: 'El nombre de la empresa es obligatorio.',
      });
      return;
    }

    const [actualizado] = await Empresa.update(datos, {
      where: {
        id: empresaId,
        activo: true,
      },
    });

    if (!actualizado) {
      res.status(404).json({
        mensaje: 'Empresa activa no encontrada.',
      });
      return;
    }

    const empresaActualizada = await Empresa.findByPk(empresaId);

    if (!empresaActualizada) {
      res.status(404).json({
        mensaje: 'Empresa no encontrada.',
      });
      return;
    }

    res.json(empresaActualizada);
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al actualizar empresa:', error);

    res.status(500).json({
      mensaje: 'Error interno al actualizar empresa.',
    });
  }
};

/**
 * La desactivación de empresas está deshabilitada hasta contar
 * con un mecanismo explícito de autorización administrativa global.
 *
 * Un administrador interno no puede desactivar organizaciones,
 * incluida su propia empresa, mediante este endpoint.
 *
 * No se realizan consultas ni modificaciones sobre Sequelize.
 */
export const eliminarEmpresa = async (
  _req: Request,
  res: Response
): Promise<void> => {
  res.status(403).json({
    mensaje: 'No autorizado para desactivar empresas.',
  });
};
