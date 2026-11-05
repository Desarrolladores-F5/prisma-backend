// src/controllers/medida_correctiva.controller.ts

import { Request, Response } from 'express';
import { Op } from 'sequelize';
import {
  MedidaCorrectiva,
  Usuario,
  Documento,
  Faena,
} from '../models';
import { registrarHistorial } from '../utils/registrarHistorial';
import { avisarMedidaCorrectiva } from '../services/notificacionesAutomaticas.service';
import { obtenerEmpresaAdministrador } from '../services/asignacionDocumental.service';

class ErrorMedida extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
  }
}

const idValido = (valor: unknown): boolean => {
  const numero = Number(valor);

  return (
    valor !== null &&
    valor !== undefined &&
    valor !== '' &&
    Number.isSafeInteger(numero) &&
    numero > 0
  );
};

const obtenerIdAutenticado = (req: Request): number => {
  const id = Number(req.usuario?.id);

  if (!idValido(id)) {
    throw new ErrorMedida(401, 'Usuario no autenticado.');
  }

  return id;
};

const obtenerUsuarioActivo = async (req: Request) => {
  const usuarioId = obtenerIdAutenticado(req);

  const usuario = await Usuario.findByPk(usuarioId, {
    attributes: ['id', 'rol_id', 'activo', 'faena_id'],
  });

  if (!usuario || usuario.activo !== true) {
    throw new ErrorMedida(
      403,
      'Usuario sin autorización o inactivo.'
    );
  }

  return usuario;
};

const verificarAdministrador = async (req: Request) => {
  const usuario = await obtenerUsuarioActivo(req);

  if (usuario.rol_id !== 1) {
    throw new ErrorMedida(
      403,
      'Se requiere un administrador activo.'
    );
  }

  const empresaId = await obtenerEmpresaAdministrador(usuario.id);

  if (!idValido(empresaId)) {
    throw new ErrorMedida(
      403,
      'No se pudo identificar la empresa del administrador.'
    );
  }

  return {
    usuarioId: usuario.id,
    empresaId,
  };
};

const validarFaenaEmpresa = async (
  faenaId: number,
  empresaId: number,
  exigirActiva = true
) => {
  if (!idValido(faenaId)) {
    throw new ErrorMedida(
      400,
      'Debe seleccionar una faena válida.'
    );
  }

  const faena = await Faena.findByPk(faenaId);

  if (
    !faena ||
    Number(faena.get('empresa_id')) !== empresaId
  ) {
    throw new ErrorMedida(
      403,
      'La faena no pertenece a la empresa autorizada.'
    );
  }

  if (exigirActiva && faena.get('activo') !== true) {
    throw new ErrorMedida(
      400,
      'La faena seleccionada no está activa.'
    );
  }

  return faena;
};

const validarResponsable = async (
  responsableId: number,
  faenaId: number
) => {
  if (!idValido(responsableId)) {
    throw new ErrorMedida(
      400,
      'Debe seleccionar un responsable válido.'
    );
  }

  const responsable = await Usuario.findByPk(responsableId, {
    attributes: ['id', 'faena_id', 'activo'],
  });

  if (
    !responsable ||
    responsable.activo !== true ||
    Number(responsable.faena_id) !== faenaId
  ) {
    throw new ErrorMedida(
      400,
      'El responsable debe estar activo y pertenecer a la faena seleccionada.'
    );
  }

  return responsable;
};

const validarEvidencia = async (
  documentoId: number | null,
  empresaId: number
): Promise<void> => {
  if (documentoId === null) return;

  if (!idValido(documentoId)) {
    throw new ErrorMedida(
      400,
      'El documento de evidencia es inválido.'
    );
  }

  const documento = await Documento.findByPk(documentoId);

  if (
    !documento ||
    Number(documento.empresa_id) !== empresaId
  ) {
    throw new ErrorMedida(
      403,
      'El documento de evidencia no pertenece a la empresa autorizada.'
    );
  }
};

const validarFecha = (valor: unknown): Date => {
  if (
    typeof valor !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    throw new ErrorMedida(
      400,
      'La fecha de cumplimiento debe tener formato AAAA-MM-DD.'
    );
  }

  const fecha = new Date(`${valor}T12:00:00.000Z`);

  if (
    Number.isNaN(fecha.getTime()) ||
    fecha.toISOString().substring(0, 10) !== valor
  ) {
    throw new ErrorMedida(
      400,
      'La fecha de cumplimiento no es válida.'
    );
  }

  return fecha;
};

const validarTexto = (
  valor: unknown,
  campo: string
): string => {
  if (
    typeof valor !== 'string' ||
    valor.trim().length === 0
  ) {
    throw new ErrorMedida(
      400,
      `El campo ${campo} es obligatorio.`
    );
  }

  return valor.trim();
};

const validarEstado = (valor: unknown): string => {
  const estado = validarTexto(valor, 'estado').toLowerCase();

  if (!['pendiente', 'en curso', 'cumplida'].includes(estado)) {
    throw new ErrorMedida(400, 'Estado inválido.');
  }

  return estado;
};

const validarPrioridad = (valor: unknown): string => {
  const prioridad = validarTexto(
    valor,
    'prioridad'
  ).toLowerCase();

  if (!['alta', 'media', 'baja'].includes(prioridad)) {
    throw new ErrorMedida(400, 'Prioridad inválida.');
  }

  return prioridad;
};

const obtenerDocumentoId = (valor: unknown): number | null => {
  if (
    valor === null ||
    valor === undefined ||
    valor === ''
  ) {
    return null;
  }

  if (!idValido(valor)) {
    throw new ErrorMedida(
      400,
      'Documento de evidencia inválido.'
    );
  }

  return Number(valor);
};

const obtenerMedidaAutorizada = async (
  id: number,
  empresaId: number
) => {
  if (!idValido(id)) {
    throw new ErrorMedida(
      400,
      'Identificador de medida inválido.'
    );
  }

  const medida = await MedidaCorrectiva.findByPk(id);

  if (!medida) {
    throw new ErrorMedida(
      404,
      'Medida correctiva no encontrada.'
    );
  }

  if (!idValido(medida.faena_id)) {
    throw new ErrorMedida(
      409,
      'Esta medida histórica no tiene una faena de origen verificada.'
    );
  }

  await validarFaenaEmpresa(
    Number(medida.faena_id),
    empresaId,
    false
  );

  return medida;
};

const responderError = (
  res: Response,
  error: unknown,
  operacion: string
): void => {
  if (error instanceof ErrorMedida) {
    res.status(error.estadoHttp).json({
      mensaje: error.message,
    });
    return;
  }

  const estado =
    typeof error === 'object' &&
    error !== null &&
    'estadoHttp' in error &&
    typeof error.estadoHttp === 'number' &&
    [400, 401, 403, 404, 409].includes(error.estadoHttp)
      ? error.estadoHttp
      : 500;

  console.error(
    `❌ Error al ${operacion} medida correctiva:`,
    error
  );

  res.status(estado).json({
    mensaje:
      estado === 500
        ? 'Error interno al procesar la medida correctiva.'
        : 'Operación no autorizada o inválida.',
  });
};

// Consultar medidas según empresa o faena autorizada.
export const obtenerMedidas = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const usuario = await obtenerUsuarioActivo(req);

    let faenaIds: number[] = [];

    if (usuario.rol_id === 1) {
      const empresaId = await obtenerEmpresaAdministrador(
        usuario.id
      );

      const faenas = await Faena.findAll({
        where: { empresa_id: empresaId },
        attributes: ['id'],
      });

      faenaIds = faenas.map(faena =>
        Number(faena.get('id'))
      );
    } else if (usuario.rol_id === 2) {
      if (!idValido(usuario.faena_id)) {
        throw new ErrorMedida(
          403,
          'Supervisor sin faena autorizada.'
        );
      }

      const faena = await Faena.findByPk(
        Number(usuario.faena_id)
      );

      if (
        !faena ||
        faena.get('activo') !== true ||
        !idValido(faena.get('empresa_id'))
      ) {
        throw new ErrorMedida(
          403,
          'Supervisor sin faena activa y válida.'
        );
      }

      faenaIds = [Number(usuario.faena_id)];
    } else {
      throw new ErrorMedida(
        403,
        'Rol no autorizado para consultar medidas.'
      );
    }

    if (faenaIds.length === 0) {
      res.json([]);
      return;
    }

    const medidas = await MedidaCorrectiva.findAll({
      where: {
        faena_id: {
          [Op.in]: faenaIds,
        },
      },
      include: [
        {
          model: Usuario,
          as: 'responsable',
          attributes: ['id', 'nombre'],
        },
        {
          model: Documento,
          as: 'evidencia',
          attributes: ['id', 'nombre'],
        },
      ],
    });

    res.json(medidas);
  } catch (error) {
    responderError(res, error, 'consultar');
  }
};

// Crear medida dentro de la empresa autorizada.
export const crearMedida = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { usuarioId, empresaId } =
      await verificarAdministrador(req);

    const datos = req.body ?? {};

    if (!idValido(datos.faena_id)) {
      throw new ErrorMedida(
        400,
        'Debe seleccionar una faena de origen.'
      );
    }

    const faenaId = Number(datos.faena_id);
    const responsableId = Number(datos.responsable_id);
    const documentoId = obtenerDocumentoId(
      datos.evidencia_documento_id
    );

    await validarFaenaEmpresa(faenaId, empresaId);
    await validarResponsable(responsableId, faenaId);
    await validarEvidencia(documentoId, empresaId);

    const nueva = await MedidaCorrectiva.create({
      descripcion: validarTexto(
        datos.descripcion,
        'descripcion'
      ),
      fecha_cumplimiento: validarFecha(
        datos.fecha_cumplimiento
      ),
      estado: validarEstado(datos.estado),
      prioridad: validarPrioridad(datos.prioridad),
      faena_id: faenaId,
      responsable_id: responsableId,
      evidencia_documento_id: documentoId ?? undefined,
    });

    await registrarHistorial({
      entidad_tipo: 'medida_correctiva',
      entidad_id: nueva.id,
      usuario_id: usuarioId,
      accion: 'creacion',
      detalles: nueva.toJSON(),
    });

    try {
      await avisarMedidaCorrectiva({
        medidaId: nueva.id,
        descripcion: nueva.descripcion,
        responsableId,
      });
    } catch (errorNotificacion) {
      console.error(
        'Medida creada, pero falló su notificación:',
        errorNotificacion
      );
    }

    res.status(201).json(nueva);
  } catch (error) {
    responderError(res, error, 'crear');
  }
};

// Actualizar sin permitir cambiar la faena de origen.
export const actualizarMedida = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { usuarioId, empresaId } =
      await verificarAdministrador(req);

    const medidaId = Number(req.params.id);
    const medida = await obtenerMedidaAutorizada(
      medidaId,
      empresaId
    );

    const datos = req.body ?? {};
    const faenaId = Number(medida.faena_id);

    if (
      Object.prototype.hasOwnProperty.call(datos, 'faena_id') &&
      Number(datos.faena_id) !== faenaId
    ) {
      throw new ErrorMedida(
        403,
        'No se permite cambiar la faena de origen.'
      );
    }

    const responsableId =
      datos.responsable_id !== undefined
        ? Number(datos.responsable_id)
        : Number(medida.responsable_id);

    const documentoId =
      datos.evidencia_documento_id !== undefined
        ? obtenerDocumentoId(datos.evidencia_documento_id)
        : obtenerDocumentoId(medida.evidencia_documento_id);

    await validarResponsable(responsableId, faenaId);
    await validarEvidencia(documentoId, empresaId);

    const actualizacion: Record<string, unknown> = {
      responsable_id: responsableId,
      evidencia_documento_id: documentoId,
    };

    if (datos.descripcion !== undefined) {
      actualizacion.descripcion = validarTexto(
        datos.descripcion,
        'descripcion'
      );
    }

    if (datos.fecha_cumplimiento !== undefined) {
      actualizacion.fecha_cumplimiento = validarFecha(
        datos.fecha_cumplimiento
      );
    }

    if (datos.estado !== undefined) {
      actualizacion.estado = validarEstado(datos.estado);
    }

    if (datos.prioridad !== undefined) {
      actualizacion.prioridad = validarPrioridad(
        datos.prioridad
      );
    }

    const estadoAnterior = medida.toJSON();

    await medida.update(actualizacion);

    await registrarHistorial({
      entidad_tipo: 'medida_correctiva',
      entidad_id: medida.id,
      usuario_id: usuarioId,
      accion: 'actualizacion',
      detalles: {
        anterior: estadoAnterior,
        nuevo: medida.toJSON(),
      },
    });

    res.json(medida);
  } catch (error) {
    responderError(res, error, 'actualizar');
  }
};

// Eliminar únicamente medidas de la empresa autorizada.
export const eliminarMedida = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { usuarioId, empresaId } =
      await verificarAdministrador(req);

    const medidaId = Number(req.params.id);
    const medida = await obtenerMedidaAutorizada(
      medidaId,
      empresaId
    );

    const datosAnteriores = medida.toJSON();

    await medida.destroy();

    await registrarHistorial({
      entidad_tipo: 'medida_correctiva',
      entidad_id: medidaId,
      usuario_id: usuarioId,
      accion: 'eliminacion',
      detalles: datosAnteriores,
    });

    res.json({
      mensaje: '✅ Medida eliminada correctamente.',
    });
  } catch (error) {
    responderError(res, error, 'eliminar');
  }
};
