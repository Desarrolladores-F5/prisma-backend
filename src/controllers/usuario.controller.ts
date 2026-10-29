// src/controllers/usuario.controller.ts
import { Request, Response } from 'express';
import { Usuario, Rol, Faena } from '../models';
import bcrypt from 'bcryptjs';

const tiposPermitidos = ['Plazo fijo', 'Indefinido', 'Honorarios', 'Jornada parcial'];

/** Devuelve ruta relativa servible: /uploads/firmas/<file> o /uploads/fotos/<file> */
const getFilePath = (req: Request, field: 'firma' | 'foto'): string | undefined => {
  const files = (req as any).files as Record<string, Express.Multer.File[]>;
  const f = files?.[field]?.[0];
  if (!f) return undefined;
  const subdir = field === 'foto' ? 'fotos' : 'firmas';
  return `/uploads/${subdir}/${f.filename}`;
};

/* ========== Crear ========== */
export const crearUsuario = async (req: Request, res: Response): Promise<void> => {
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

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(contraseña, salt);

    const firma_imagen_url = getFilePath(req, 'firma');
    const foto_url = getFilePath(req, 'foto');

    const usuario = await Usuario.create({
      ...datosRestantes,
      contraseña_hash: hash,
      salt,
      firma_imagen_url,
      foto_url,
    });

    res.status(201).json({ mensaje: '✅ Usuario creado correctamente', usuario });
  } catch (error: any) {
    console.error('❌ Error al crear usuario:', error);
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
export const actualizarUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const datos: any = req.body || {};

    const tipoContrato = datos.tipo_contrato?.trim();
    if (!tipoContrato || !tiposPermitidos.includes(tipoContrato)) {
      res.status(400).json({ mensaje: '❌ Tipo de contrato no válido' });
      return;
    }

    const usuario = await Usuario.findByPk(id);
    if (!usuario) {
      res.status(404).json({ mensaje: 'Usuario no encontrado' });
      return;
    }

    if (datos.contraseña && datos.contraseña.trim() !== '') {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(datos.contraseña, salt);
      datos.contraseña_hash = hash;
      datos.salt = salt;
    }
    delete datos.contraseña;

    const nuevaFirma = getFilePath(req, 'firma');
    if (nuevaFirma) datos.firma_imagen_url = nuevaFirma;

    const nuevaFoto = getFilePath(req, 'foto');
    if (nuevaFoto) datos.foto_url = nuevaFoto;

    await usuario.update(datos);

    res.json({ mensaje: '✅ Usuario actualizado correctamente', id: usuario.id });
  } catch (error: any) {
    console.error('❌ Error al actualizar usuario:', error);
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
export const obtenerUsuarios = async (_req: Request, res: Response): Promise<void> => {
  try {
    const usuarios = await Usuario.findAll({
      where: { activo: true },
      include: [
        { model: Rol, as: 'rol', attributes: ['id', 'nombre', 'descripcion'] },
        { model: Faena, as: 'faena', attributes: ['id', 'nombre'] },
      ],
    });
    res.status(200).json(usuarios);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener usuarios', error });
  }
};

/* ========== Eliminar (inactivar) ========== */
export const eliminarUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const usuario = await Usuario.findByPk(id);
    if (!usuario) {
      res.status(404).json({ mensaje: 'Usuario no encontrado' });
      return;
    }
    await usuario.update({ activo: false });
    res.json({ mensaje: '✅ Usuario desactivado correctamente' });
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al desactivar usuario', error });
  }
};

/* ========== Reactivar ========== */
export const reactivarUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const usuario = await Usuario.findByPk(id);
    if (!usuario) {
      res.status(404).json({ mensaje: 'Usuario no encontrado' });
      return;
    }
    await usuario.update({ activo: true });
    res.json({ mensaje: '✅ Usuario reactivado correctamente' });
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al reactivar usuario', error });
  }
};

/* ========== Conteo de activos ========== */
export const contarUsuarios = async (_req: Request, res: Response): Promise<void> => {
  try {
    const total = await Usuario.count({ where: { activo: true } });
    res.json({ total });
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al contar usuarios', error });
  }
};

/* ========== Listar por faena (activos) ========== */
export const obtenerUsuariosPorFaena = async (req: Request, res: Response): Promise<void> => {
  try {
    const { faenaId } = req.params;
    const usuarios = await Usuario.findAll({
      where: { activo: true, faena_id: faenaId },
      include: [
        { model: Rol, as: 'rol', attributes: ['id', 'nombre', 'descripcion'] },
        { model: Faena, as: 'faena', attributes: ['id', 'nombre'] },
      ],
    });
    res.status(200).json(usuarios);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener usuarios por faena', error });
  }
};

/* ========== Obtener por ID ========== */
export const obtenerUsuarioPorId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const usuario = await Usuario.findByPk(id, {
      include: [
        { model: Rol, as: 'rol', attributes: ['id', 'nombre'] },
        { model: Faena, as: 'faena', attributes: ['id', 'nombre'] },
      ],
    });
    if (!usuario) {
      res.status(404).json({ mensaje: 'Usuario no encontrado' });
      return;
    }
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener usuario', error });
  }
};
