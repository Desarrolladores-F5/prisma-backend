// src/controllers/usuario.controller.ts
import { Request, Response } from 'express';
import { Usuario, Rol, Faena } from '../models';
import bcrypt from 'bcryptjs';
import type { RequestConUsuario } from '../middlewares/validarToken';
import {
  obtenerEmpresaUsuarioInterno,
  obtenerEmpresaAdministradorUsuarios,
  ErrorAutorizacionUsuarioInterno,
} from '../services/autorizacionUsuariosInternos.service';

const tiposPermitidos = ['Plazo fijo', 'Indefinido', 'Honorarios', 'Jornada parcial'];

const camposCredenciales = ['contraseña_hash', 'salt'];

function usuarioSinCredenciales(usuario: Usuario): Record<string, unknown> {
  const datos = typeof usuario.toJSON === 'function'
    ? usuario.toJSON()
    : usuario;

  const seguro = { ...datos } as Record<string, unknown>;

  for (const campo of camposCredenciales) {
    delete seguro[campo];
  }

  return seguro;
}

/** Devuelve ruta relativa servible: /uploads/firmas/<file> o /uploads/fotos/<file> */
const getFilePath = (req: Request, field: 'firma' | 'foto'): string | undefined => {
  const files = (req as any).files as Record<string, Express.Multer.File[]>;
  const f = files?.[field]?.[0];
  if (!f) return undefined;
  const subdir = field === 'foto' ? 'fotos' : 'firmas';
  return `/uploads/${subdir}/${f.filename}`;
};

/* ========== Crear ========== */
export const crearUsuario = async (req: RequestConUsuario, res: Response): Promise<void> => {
  try {
    const body = { ...(req.body || {}) };

    // Compatibilidad con nombres de campos UTF-8
    // interpretados como Latin-1 por Multer.
    if (body['contraseña'] === undefined && body['contraseÃ±a'] !== undefined) {
      body['contraseña'] = body['contraseÃ±a'];
    }

    delete body['contraseÃ±a'];

    const { contraseña, ...datosRestantes } = body;

    if (!tiposPermitidos.includes(datosRestantes.tipo_contrato)) {
      res.status(400).json({ mensaje: '❌ Tipo de contrato no válido' });
      return;
    }
    if (!contraseña || contraseña.trim() === '') {
      res.status(400).json({ mensaje: '❌ La contraseña es obligatoria' });
      return;
    }

    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const faenaId = Number(datosRestantes.faena_id);

    if (
      !Number.isSafeInteger(faenaId) ||
      faenaId <= 0
    ) {
      res.status(400).json({
        mensaje: 'Debe seleccionar una faena válida.',
      });
      return;
    }

    const faena = await Faena.findByPk(faenaId, {
      attributes: ['id', 'empresa_id'],
    });

    const empresaFaena = Number(faena?.get('empresa_id'));

    if (
      !faena ||
      !Number.isSafeInteger(empresaFaena) ||
      empresaFaena !== empresaId
    ) {
      res.status(403).json({
        mensaje: 'La faena no pertenece a su empresa.',
      });
      return;
    }

    const rolId = Number(datosRestantes.rol_id);

    if (
      !Number.isSafeInteger(rolId) ||
      ![1, 2, 3].includes(rolId)
    ) {
      res.status(400).json({
        mensaje: 'Debe seleccionar un rol interno válido.',
      });
      return;
    }

    const camposPermitidos = [
      'rut',
      'nombre',
      'apellido',
      'correo',
      'telefono',
      'fecha_nacimiento',
      'fecha_contrato',
      'tipo_contrato',
      'contacto_emergencia_nombre',
      'contacto_emergencia_telefono',
    ] as const;

    const datosPermitidos: Record<string, unknown> = {};

    for (const campo of camposPermitidos) {
      if (Object.prototype.hasOwnProperty.call(datosRestantes, campo)) {
        datosPermitidos[campo] = datosRestantes[campo];
      }
    }

    datosPermitidos.rol_id = rolId;
    datosPermitidos.faena_id = faenaId;

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(contraseña, salt);

    const firma_imagen_url = getFilePath(req, 'firma');
    const foto_url = getFilePath(req, 'foto');

    const usuario = await Usuario.create({
      ...datosPermitidos,
      contraseña_hash: hash,
      salt,
      firma_imagen_url,
      foto_url,
    } as unknown as import('../models/usuario.model').UsuarioCreationAttributes);

    res.status(201).json({
      mensaje: '✅ Usuario creado correctamente',
      usuario: usuarioSinCredenciales(usuario),
    });
  } catch (error: any) {
    console.error('❌ Error al crear usuario:', error);

    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
      res.status(400).json({
        mensaje: 'El RUT o el correo ya están registrados',
        campo: error.errors?.[0]?.path,
      });
      return;
    }
    res.status(500).json({ mensaje: '❌ Error interno al crear usuario', error });
  }
};

/* ========== Actualizar ========== */
export const actualizarUsuario = async (req: RequestConUsuario, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const datos: any = req.body || {};

    const tipoContrato = datos.tipo_contrato?.trim();
    if (!tipoContrato || !tiposPermitidos.includes(tipoContrato)) {
      res.status(400).json({ mensaje: '❌ Tipo de contrato no válido' });
      return;
    }

    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const usuario = await Usuario.findByPk(id, {
      include: [
        {
          model: Faena,
          as: 'faena',
          attributes: [],
          required: true,
          where: {
            empresa_id: empresaId,
          },
        },
      ],
    });

    if (!usuario) {
      res.status(404).json({
        mensaje: 'Usuario no encontrado',
      });
      return;
    }

    const faenaId = Number(datos.faena_id);

    if (
      !Number.isSafeInteger(faenaId) ||
      faenaId <= 0
    ) {
      res.status(400).json({
        mensaje: 'Debe seleccionar una faena válida.',
      });
      return;
    }

    const faenaDestino = await Faena.findByPk(faenaId, {
      attributes: ['id', 'empresa_id'],
    });

    const empresaFaena = Number(
      faenaDestino?.get('empresa_id')
    );

    if (
      !faenaDestino ||
      !Number.isSafeInteger(empresaFaena) ||
      empresaFaena !== empresaId
    ) {
      res.status(403).json({
        mensaje: 'La faena no pertenece a su empresa.',
      });
      return;
    }

    datos.faena_id = faenaId;

    const rolId = Number(datos.rol_id);

    if (
      !Number.isSafeInteger(rolId) ||
      ![1, 2, 3].includes(rolId)
    ) {
      res.status(400).json({
        mensaje: 'Debe seleccionar un rol interno válido.',
      });
      return;
    }

    const camposPermitidos = [
      'rut',
      'nombre',
      'apellido',
      'correo',
      'telefono',
      'fecha_nacimiento',
      'fecha_contrato',
      'tipo_contrato',
      'contacto_emergencia_nombre',
      'contacto_emergencia_telefono',
    ] as const;

    const datosActualizacion: Record<string, unknown> = {};

    for (const campo of camposPermitidos) {
      if (Object.prototype.hasOwnProperty.call(datos, campo)) {
        datosActualizacion[campo] = datos[campo];
      }
    }

    datosActualizacion.rol_id = rolId;
    datosActualizacion.faena_id = faenaId;

    if (
      typeof datos.contraseña === 'string' &&
      datos.contraseña.trim() !== ''
    ) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(datos.contraseña, salt);

      datosActualizacion.contraseña_hash = hash;
      datosActualizacion.salt = salt;
    }

    const nuevaFirma = getFilePath(req, 'firma');
    if (nuevaFirma) {
      datosActualizacion.firma_imagen_url = nuevaFirma;
    }

    const nuevaFoto = getFilePath(req, 'foto');
    if (nuevaFoto) {
      datosActualizacion.foto_url = nuevaFoto;
    }

    await usuario.update(datosActualizacion);

    res.json({ mensaje: '✅ Usuario actualizado correctamente', id: usuario.id });
  } catch (error: any) {
    console.error('❌ Error al actualizar usuario:', error);

    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
      res.status(400).json({
        mensaje: 'El RUT o el correo ya están registrados',
        campo: error.errors?.[0]?.path,
      });
      return;
    }
    res.status(500).json({ mensaje: '❌ Error al actualizar usuario', error });
  }
};

/* ========== Listar (activos) ========== */
export const obtenerUsuarios = async (req: RequestConUsuario, res: Response): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaUsuarioInterno(
      req.usuario?.id
    );

    const usuarios = await Usuario.findAll({
      attributes: {
        exclude: camposCredenciales,
      },
      where: { activo: true },
      include: [
        { model: Rol, as: 'rol', attributes: ['id', 'nombre', 'descripcion'] },
        {
          model: Faena,
          as: 'faena',
          attributes: ['id', 'nombre'],
          required: true,
          where: {
            empresa_id: empresaId,
          },
        },
      ],
    });

    res.status(200).json(usuarios.map(usuarioSinCredenciales));
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al obtener usuarios:', error);
    res.status(500).json({
      mensaje: 'Error interno al obtener usuarios.',
    });
  }
};

/* ========== Eliminar (inactivar) ========== */
export const eliminarUsuario = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const usuario = await Usuario.findByPk(req.params.id, {
      include: [{
        model: Faena,
        as: 'faena',
        attributes: [],
        required: true,
        where: { empresa_id: empresaId },
      }],
    });

    if (!usuario) {
      res.status(404).json({ mensaje: 'Usuario no encontrado' });
      return;
    }

    await usuario.update({ activo: false });

    res.json({ mensaje: 'Usuario desactivado correctamente' });
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('Error al desactivar usuario:', error);
    res.status(500).json({
      mensaje: 'Error interno al desactivar usuario.',
    });
  }
};

/* ========== Reactivar ========== */
export const reactivarUsuario = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaAdministradorUsuarios(
      req.usuario?.id
    );

    const usuario = await Usuario.findByPk(req.params.id, {
      include: [{
        model: Faena,
        as: 'faena',
        attributes: [],
        required: true,
        where: { empresa_id: empresaId },
      }],
    });

    if (!usuario) {
      res.status(404).json({ mensaje: 'Usuario no encontrado' });
      return;
    }

    await usuario.update({ activo: true });

    res.json({ mensaje: 'Usuario reactivado correctamente' });
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({ mensaje: error.message });
      return;
    }

    console.error('Error al reactivar usuario:', error);
    res.status(500).json({
      mensaje: 'Error interno al reactivar usuario.',
    });
  }
};

/* ========== Conteo de activos ========== */
export const contarUsuarios = async (
  req: RequestConUsuario,
  res: Response
): Promise<void> => {
  try {
    const empresaId = await obtenerEmpresaUsuarioInterno(
      req.usuario?.id
    );

    const total = await Usuario.count({
      where: { activo: true },
      include: [{
        model: Faena,
        as: 'faena',
        attributes: [],
        required: true,
        where: { empresa_id: empresaId },
      }],
    });

    res.json({ total });
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al contar usuarios:', error);
    res.status(500).json({
      mensaje: 'Error interno al contar usuarios.',
    });
  }
};

/* ========== Listar por faena (activos) ========== */
export const obtenerUsuariosPorFaena = async (req: RequestConUsuario, res: Response): Promise<void> => {
  try {
    const { faenaId } = req.params;

    const empresaId = await obtenerEmpresaUsuarioInterno(
      req.usuario?.id
    );

    const usuarios = await Usuario.findAll({
      attributes: {
        exclude: camposCredenciales,
      },
      where: { activo: true, faena_id: faenaId },
      include: [
        { model: Rol, as: 'rol', attributes: ['id', 'nombre', 'descripcion'] },
        {
          model: Faena,
          as: 'faena',
          attributes: ['id', 'nombre'],
          required: true,
          where: {
            empresa_id: empresaId,
          },
        },
      ],
    });

    res.status(200).json(usuarios.map(usuarioSinCredenciales));
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al obtener usuarios por faena:', error);
    res.status(500).json({
      mensaje: 'Error interno al obtener usuarios por faena.',
    });
  }
};

/* ========== Obtener por ID ========== */
export const obtenerUsuarioPorId = async (req: RequestConUsuario, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const empresaId = await obtenerEmpresaUsuarioInterno(
      req.usuario?.id
    );

    const usuario = await Usuario.findByPk(id, {
      attributes: {
        exclude: camposCredenciales,
      },
      include: [
        { model: Rol, as: 'rol', attributes: ['id', 'nombre'] },
        {
          model: Faena,
          as: 'faena',
          attributes: ['id', 'nombre'],
          required: true,
          where: {
            empresa_id: empresaId,
          },
        },
      ],
    });

    if (!usuario) {
      res.status(404).json({
        mensaje: 'Usuario no encontrado',
      });
      return;
    }

    res.json(usuarioSinCredenciales(usuario));
  } catch (error) {
    if (error instanceof ErrorAutorizacionUsuarioInterno) {
      res.status(error.estadoHttp).json({
        mensaje: error.message,
      });
      return;
    }

    console.error('Error al obtener usuario:', error);
    res.status(500).json({
      mensaje: 'Error interno al obtener usuario.',
    });
  }
};
