// src/controllers/epp.controller.ts

import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { EPP, Usuario, Faena, Documento } from '../models';
import type { EPPAttributes } from '../models/epp.model';
import { avisarEntregaEPP } from '../services/notificacionesAutomaticas.service';
import { obtenerEmpresaAdministrador } from '../services/asignacionDocumental.service';

class ErrorEPP extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
  }
}

const idValido = (valor: unknown): boolean => {
  if (valor === null || valor === undefined || valor === '') {
    return false;
  }

  const numero = Number(valor);

  return Number.isSafeInteger(numero) && numero > 0;
};

const camposPermitidos = [
  'usuario_id',
  'tipo',
  'descripcion',
  'faena_id',
  'fecha_entrega',
  'fecha_vencimiento',
  'estado',
  'documento_id',
] as const;

type CampoEPP = typeof camposPermitidos[number];

type DatosEPP = Partial<Record<CampoEPP, unknown>>;

const extraerCampos = (body: unknown): DatosEPP => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new ErrorEPP(
      400,
      'Debe proporcionar datos válidos del EPP.'
    );
  }

  const origen = body as Record<string, unknown>;
  const resultado: DatosEPP = {};

  for (const campo of camposPermitidos) {
    if (Object.prototype.hasOwnProperty.call(origen, campo)) {
      resultado[campo] = origen[campo];
    }
  }

  return resultado;
};

const comprobarTexto = (
  valor: unknown,
  campo: string,
  obligatorio = true
): string => {
  if (valor === null && !obligatorio) {
    return '';
  }

  if (
    typeof valor !== 'string' ||
    (obligatorio && !valor.trim())
  ) {
    throw new ErrorEPP(
      400,
      `El campo ${campo} no es válido.`
    );
  }

  return valor.trim();
};

const comprobarFecha = (
  valor: unknown,
  campo: string
): Date => {
  if (
    typeof valor !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(valor)
  ) {
    throw new ErrorEPP(
      400,
      `La fecha ${campo} no es válida.`
    );
  }

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    throw new ErrorEPP(
      400,
      `La fecha ${campo} no es válida.`
    );
  }

  return fecha;
};

const administradorAutorizado = async (
  req: Request
): Promise<number> => {
  const id = req.usuario?.id;

  if (!idValido(id)) {
    throw new ErrorEPP(
      401,
      'Usuario no autenticado.'
    );
  }

  return obtenerEmpresaAdministrador(Number(id));
};

const validarFaena = async (
  faenaId: number,
  empresaId: number
) => {
  if (!idValido(faenaId)) {
    throw new ErrorEPP(
      400,
      'Debe seleccionar una faena válida.'
    );
  }

  const faena = await Faena.findByPk(faenaId);

  if (
    !faena ||
    Number(faena.get('empresa_id')) !== empresaId
  ) {
    throw new ErrorEPP(
      403,
      'La faena no pertenece a su empresa.'
    );
  }

  if (faena.get('activo') !== true) {
    throw new ErrorEPP(
      400,
      'La faena seleccionada está inactiva.'
    );
  }

  return faena;
};

const validarTrabajador = async (
  usuarioId: number,
  faenaId: number
) => {
  if (!idValido(usuarioId)) {
    throw new ErrorEPP(
      400,
      'Debe seleccionar un trabajador válido.'
    );
  }

  const trabajador = await Usuario.findByPk(usuarioId);

  if (
    !trabajador ||
    trabajador.activo !== true ||
    Number(trabajador.faena_id) !== faenaId
  ) {
    throw new ErrorEPP(
      400,
      'El trabajador debe estar activo y pertenecer a la faena seleccionada.'
    );
  }

  return trabajador;
};

const validarDocumento = async (
  documentoId: number | null,
  empresaId: number
) => {
  if (documentoId === null) {
    return;
  }

  if (!idValido(documentoId)) {
    throw new ErrorEPP(
      400,
      'El documento asociado no es válido.'
    );
  }

  const documento = await Documento.findByPk(documentoId);

  if (
    !documento ||
    documento.empresa_id === null ||
    Number(documento.empresa_id) !== empresaId
  ) {
    throw new ErrorEPP(
      403,
      'El documento no pertenece a su empresa.'
    );
  }
};

const obtenerRegistroAutorizado = async (
  id: unknown,
  empresaId: number
) => {
  if (!idValido(id)) {
    throw new ErrorEPP(
      400,
      'Identificador de EPP inválido.'
    );
  }

  const registro = await EPP.findByPk(Number(id));

  if (!registro || registro.activo !== true) {
    throw new ErrorEPP(
      404,
      'EPP no encontrado.'
    );
  }

  // No atribuir automáticamente una faena a registros
  // históricos cuyo origen todavía no está validado.
  if (!idValido(registro.faena_id)) {
    throw new ErrorEPP(
      409,
      'Este EPP histórico no tiene faena de origen validada.'
    );
  }

  const faena = await Faena.findByPk(
    Number(registro.faena_id)
  );

  if (
    !faena ||
    Number(faena.get('empresa_id')) !== empresaId
  ) {
    throw new ErrorEPP(
      404,
      'EPP no encontrado.'
    );
  }

  return registro;
};

const enviarError = (
  res: Response,
  error: unknown,
  contexto: string
): void => {
  if (error instanceof ErrorEPP) {
    res.status(error.estadoHttp).json({
      mensaje: error.message,
    });
    return;
  }

  const estado = (
    error as { estadoHttp?: unknown } | null
  )?.estadoHttp;

  if (
    typeof estado === 'number' &&
    estado >= 400 &&
    estado < 500
  ) {
    res.status(estado).json({
      mensaje: (error as Error).message,
    });
    return;
  }

  console.error(contexto, error);

  res.status(500).json({
    mensaje: 'Error interno del módulo EPP.',
  });
};

// ============================================================
// LISTAR EPP - ADMINISTRADOR
// ============================================================

export const obtenerEPP = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await administradorAutorizado(req);

    const faenas = await Faena.findAll({
      where: {
        empresa_id: empresaId,
      },
      attributes: ['id'],
    });

    // Corrección de tipado de Sequelize:
    // acceder al ID mediante get('id').
    const ids = faenas.map(
      faena => Number(faena.get('id'))
    );

    if (ids.length === 0) {
      res.json([]);
      return;
    }

    const registros = await EPP.findAll({
      where: {
        activo: true,
        faena_id: {
          [Op.in]: ids,
        },
      },
      include: [
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['nombre', 'apellido'],
        },
        {
          model: Faena,
          as: 'faena',
          attributes: ['nombre'],
        },
      ],
    });

    res.json(registros);
  } catch (error) {
    enviarError(
      res,
      error,
      'Error al consultar EPP:'
    );
  }
};

// ============================================================
// CREAR EPP - ADMINISTRADOR
// ============================================================

export const crearEPP = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await administradorAutorizado(req);
    const datos = extraerCampos(req.body);

    if (
      !idValido(datos.faena_id) ||
      !idValido(datos.usuario_id)
    ) {
      throw new ErrorEPP(
        400,
        'Debe indicar faena y trabajador válidos.'
      );
    }

    const faenaId = Number(datos.faena_id);
    const usuarioId = Number(datos.usuario_id);

    await validarFaena(faenaId, empresaId);
    await validarTrabajador(usuarioId, faenaId);

    await validarDocumento(
      datos.documento_id == null
        ? null
        : Number(datos.documento_id),
      empresaId
    );

    const nuevo = await EPP.create({
      usuario_id: usuarioId,
      faena_id: faenaId,
      tipo: comprobarTexto(datos.tipo, 'tipo'),
      descripcion:
        datos.descripcion == null
          ? undefined
          : comprobarTexto(
              datos.descripcion,
              'descripcion',
              false
            ),
      fecha_entrega: comprobarFecha(
        datos.fecha_entrega,
        'fecha_entrega'
      ),
      fecha_vencimiento: comprobarFecha(
        datos.fecha_vencimiento,
        'fecha_vencimiento'
      ),
      estado: comprobarTexto(datos.estado, 'estado'),
      documento_id:
        datos.documento_id == null
          ? undefined
          : Number(datos.documento_id),
      activo: true,
    });

    // Las notificaciones no deben impedir que el registro
    // del EPP termine correctamente.
    try {
      await avisarEntregaEPP({
        eppId: nuevo.id,
        trabajadorId: usuarioId,
        faenaId,
        tipo: nuevo.tipo,
      });
    } catch (errorNotificacion) {
      console.error(
        'EPP registrado, pero falló la notificación:',
        errorNotificacion
      );
    }

    res.status(201).json(nuevo);
  } catch (error) {
    enviarError(
      res,
      error,
      'Error al crear EPP:'
    );
  }
};

// ============================================================
// ACTUALIZAR EPP - ADMINISTRADOR
// ============================================================

export const actualizarEPP = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await administradorAutorizado(req);

    const registro = await obtenerRegistroAutorizado(
      req.params.id,
      empresaId
    );

    await validarFaena(
      Number(registro.faena_id),
      empresaId
    );

    const datos = extraerCampos(req.body);

    if (Object.keys(datos).length === 0) {
      throw new ErrorEPP(
        400,
        'No hay campos válidos para actualizar.'
      );
    }

    const faenaId = Number(registro.faena_id);

    if (
      'faena_id' in datos &&
      Number(datos.faena_id) !== faenaId
    ) {
      throw new ErrorEPP(
        409,
        'No se permite cambiar la faena de origen del EPP.'
      );
    }

    const usuarioId =
      'usuario_id' in datos
        ? Number(datos.usuario_id)
        : Number(registro.usuario_id);

    await validarTrabajador(usuarioId, faenaId);

    if ('documento_id' in datos) {
      await validarDocumento(
        datos.documento_id == null
          ? null
          : Number(datos.documento_id),
        empresaId
      );
    }

    const cambios: Partial<EPPAttributes> = {};

    if ('usuario_id' in datos) {
      cambios.usuario_id = usuarioId;
    }

    if ('tipo' in datos) {
      cambios.tipo = comprobarTexto(
        datos.tipo,
        'tipo'
      );
    }

    if ('descripcion' in datos) {
      cambios.descripcion = comprobarTexto(
        datos.descripcion,
        'descripcion',
        false
      );
    }

    if ('fecha_entrega' in datos) {
      cambios.fecha_entrega = comprobarFecha(
        datos.fecha_entrega,
        'fecha_entrega'
      );
    }

    if ('fecha_vencimiento' in datos) {
      cambios.fecha_vencimiento = comprobarFecha(
        datos.fecha_vencimiento,
        'fecha_vencimiento'
      );
    }

    if ('estado' in datos) {
      cambios.estado = comprobarTexto(
        datos.estado,
        'estado'
      );
    }

    if ('documento_id' in datos) {
      // MySQL admite NULL en este campo.
      cambios.documento_id =
        datos.documento_id == null
          ? (null as unknown as number)
          : Number(datos.documento_id);
    }

    if (Object.keys(cambios).length === 0) {
      throw new ErrorEPP(
        400,
        'No hay cambios permitidos.'
      );
    }

    await registro.update(cambios);

    const actualizado = await EPP.findByPk(
      registro.id,
      {
        include: [
          {
            model: Usuario,
            as: 'usuario',
            attributes: ['nombre', 'apellido'],
          },
          {
            model: Faena,
            as: 'faena',
            attributes: ['nombre'],
          },
        ],
      }
    );

    res.json(actualizado);
  } catch (error) {
    enviarError(
      res,
      error,
      'Error al actualizar EPP:'
    );
  }
};

// ============================================================
// ELIMINAR EPP - ADMINISTRADOR
// ============================================================

export const eliminarEPP = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await administradorAutorizado(req);

    const registro = await obtenerRegistroAutorizado(
      req.params.id,
      empresaId
    );

    await registro.update({
      activo: false,
    });

    res.json({
      mensaje: '✅ EPP eliminado correctamente (soft delete)',
    });
  } catch (error) {
    enviarError(
      res,
      error,
      'Error al eliminar EPP:'
    );
  }
};

// ============================================================
// CONSULTAR MIS EPP - TRABAJADOR
// ============================================================

export const obtenerEppDelUsuario = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const usuarioId = Number(req.usuario?.id);

    if (!idValido(usuarioId)) {
      throw new ErrorEPP(
        401,
        'Usuario no autenticado.'
      );
    }

    const usuario = await Usuario.findByPk(usuarioId);

    if (
      !usuario ||
      usuario.activo !== true ||
      usuario.rol_id !== 3
    ) {
      throw new ErrorEPP(
        403,
        'Trabajador no autorizado o inactivo.'
      );
    }

    const registros = await EPP.findAll({
      where: {
        usuario_id: usuarioId,
        activo: true,
      },
      include: [
        {
          model: Faena,
          as: 'faena',
          attributes: ['nombre'],
        },
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['nombre', 'apellido'],
        },
      ],
    });

    res.json(registros);
  } catch (error) {
    enviarError(
      res,
      error,
      'Error al consultar mis EPP:'
    );
  }
};
