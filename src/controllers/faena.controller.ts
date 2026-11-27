import { Request, Response } from 'express';
import { Faena, Empresa, Usuario } from '../models';
import type { RequestConUsuario } from '../middlewares/validarToken';
import {
  obtenerEmpresaUsuarioInterno,
  obtenerEmpresaAdministradorUsuarios,
  ErrorAutorizacionUsuarioInterno,
} from '../services/autorizacionUsuariosInternos.service';

export const obtenerFaenas = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaUsuarioInterno(
      req.usuario?.id
    );

    const faenas = await Faena.findAll({
      where: {
        activo: true,
        empresa_id: empresaId,
      },
      include: [
        {
          model: Empresa,
          as: 'empresa',
          attributes: ['id', 'nombre'],
        },
        {
          model: Usuario,
          as: 'responsable',
          attributes: ['id', 'nombre', 'apellido'],
        },
      ],
    });

    res.json(faenas);
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al obtener faenas:', error);

    res.status(500).json({
      mensaje: 'Error interno al obtener faenas.',
    });
  }
};

export const crearFaena = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    // El rol y la empresa se verifican con los datos vigentes en MySQL.
    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const body = req.body || {};

    const nombre =
      typeof body.nombre === 'string' ? body.nombre.trim() : '';

    const ubicacion =
      typeof body.ubicacion === 'string' ? body.ubicacion.trim() : '';

    if (!nombre || !ubicacion) {
      res.status(400).json({
        mensaje: 'Nombre y ubicación son obligatorios.',
      });
      return;
    }

    const responsableId = Number(body.responsable_id);

    if (
      !Number.isSafeInteger(responsableId) ||
      responsableId <= 0
    ) {
      res.status(400).json({
        mensaje: 'Debe seleccionar un responsable válido.',
      });
      return;
    }

    // Comprobamos la pertenencia del responsable mediante su faena real.
    const responsable = await Usuario.findByPk(responsableId, {
      attributes: ['id', 'activo', 'faena_id'],
    });

    if (!responsable || responsable.get('activo') !== true) {
      res.status(403).json({
        mensaje: 'Responsable no autorizado para esta empresa.',
      });
      return;
    }

    const faenaResponsableId = Number(responsable.get('faena_id'));

    if (
      !Number.isSafeInteger(faenaResponsableId) ||
      faenaResponsableId <= 0
    ) {
      res.status(403).json({
        mensaje: 'No se pudo verificar la empresa del responsable.',
      });
      return;
    }

    const faenaResponsable = await Faena.findByPk(faenaResponsableId, {
      attributes: ['id', 'empresa_id'],
    });

    const empresaResponsableId = Number(
      faenaResponsable?.get('empresa_id')
    );

    if (
      !faenaResponsable ||
      empresaResponsableId !== empresaId
    ) {
      res.status(403).json({
        mensaje: 'El responsable no pertenece a su empresa.',
      });
      return;
    }

    // Lista blanca: nunca copiar indiscriminadamente req.body.
    const datos: Record<string, unknown> = {
      nombre,
      ubicacion,
      empresa_id: empresaId,
      responsable_id: responsableId,
      activo: true,
    };

    for (const campo of ['descripcion', 'estado'] as const) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        datos[campo] = body[campo];
      }
    }

    for (const campo of ['fecha_inicio', 'fecha_termino'] as const) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        datos[campo] = body[campo] === '' ? null : body[campo];
      }
    }

    const nueva = await Faena.create(datos);

    res.status(201).json({
      mensaje: '✅ Faena creada',
      id: nueva.getDataValue('id'),
    });
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al crear faena:', error);

    res.status(500).json({
      mensaje: 'Error interno al crear faena.',
    });
  }
};

export const actualizarFaena = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({
        mensaje: 'Identificador de faena inválido.',
      });
      return;
    }

    const faena = await Faena.findOne({
      where: {
        id,
        activo: true,
        empresa_id: empresaId,
      },
    });

    if (!faena) {
      res.status(404).json({
        mensaje: 'Faena no encontrada',
      });
      return;
    }

    const body = req.body || {};

    const datos: Record<string, unknown> = {};

    for (const campo of ['nombre', 'ubicacion'] as const) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        const valor = body[campo];

        if (typeof valor !== 'string' || !valor.trim()) {
          res.status(400).json({
            mensaje: `El campo ${campo} debe contener texto válido.`,
          });
          return;
        }

        datos[campo] = valor.trim();
      }
    }

    for (const campo of ['descripcion', 'estado'] as const) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        datos[campo] = body[campo];
      }
    }

    for (const campo of ['fecha_inicio', 'fecha_termino'] as const) {
      if (Object.prototype.hasOwnProperty.call(body, campo)) {
        datos[campo] = body[campo] === '' ? null : body[campo];
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'responsable_id')) {
      const responsableId = Number(body.responsable_id);

      if (!Number.isSafeInteger(responsableId) || responsableId <= 0) {
        res.status(400).json({
          mensaje: 'Debe seleccionar un responsable válido.',
        });
        return;
      }

      const responsable = await Usuario.findByPk(responsableId, {
        attributes: ['id', 'activo', 'faena_id'],
      });

      if (!responsable || responsable.get('activo') !== true) {
        res.status(403).json({
          mensaje: 'Responsable no autorizado para esta empresa.',
        });
        return;
      }

      const faenaResponsableId = Number(responsable.get('faena_id'));

      if (
        !Number.isSafeInteger(faenaResponsableId) ||
        faenaResponsableId <= 0
      ) {
        res.status(403).json({
          mensaje: 'No se pudo verificar la empresa del responsable.',
        });
        return;
      }

      const faenaResponsable = await Faena.findByPk(faenaResponsableId, {
        attributes: ['id', 'empresa_id'],
      });

      if (
        !faenaResponsable ||
        Number(faenaResponsable.get('empresa_id')) !== empresaId
      ) {
        res.status(403).json({
          mensaje: 'El responsable no pertenece a su empresa.',
        });
        return;
      }

      datos.responsable_id = responsableId;
    }

    // id, empresa_id, activo y fecha_creacion nunca
    // se copian desde el cliente.
    await faena.update(datos);

    res.json({
      mensaje: '✅ Faena actualizada',
      id,
    });
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al actualizar faena:', error);

    res.status(500).json({
      mensaje: 'Error interno al actualizar faena.',
    });
  }
};

export const eliminarFaena = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    // Verificar permisos administrativos vigentes en MySQL.
    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({
        mensaje: 'Identificador de faena inválido.',
      });
      return;
    }

    // No buscar por ID solamente: exigir pertenencia empresarial.
    const faena = await Faena.findOne({
      where: {
        id,
        empresa_id: empresaId,
        activo: true,
      },
    });

    if (!faena) {
      res.status(404).json({
        mensaje: 'Faena no encontrada',
      });
      return;
    }

    // Desactivación lógica: conservar registro y relaciones.
    await faena.update({
      activo: false,
    });

    res.json({
      mensaje: '✅ Faena eliminada',
    });
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al desactivar faena:', error);

    res.status(500).json({
      mensaje: 'Error interno al desactivar faena.',
    });
  }
};
