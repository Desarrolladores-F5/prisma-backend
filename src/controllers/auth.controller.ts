import { Request, Response } from 'express';
import { Usuario } from '../models';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const login = async (req: Request, res: Response) => {
  try {
    const { correo, contraseña } = req.body;

    if (!correo || !contraseña) {
      res.status(400).json({
        mensaje: 'Correo y contraseña son obligatorios',
      });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret || jwtSecret.length < 32) {
      console.error('Configuración JWT inválida o insuficiente');
      res.status(500).json({
        mensaje: 'Error interno de autenticación',
      });
      return;
    }

    const usuario = await Usuario.findOne({
      where: { correo },
    });

    if (!usuario) {
      res.status(401).json({
        mensaje: 'Credenciales incorrectas',
      });
      return;
    }

    if (!usuario.activo) {
      res.status(403).json({
        mensaje: 'Usuario desactivado',
      });
      return;
    }

    const passwordValido = bcrypt.compareSync(
      contraseña,
      usuario.contraseña_hash
    );

    if (!passwordValido) {
      res.status(401).json({
        mensaje: 'Credenciales incorrectas',
      });
      return;
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol_id: usuario.rol_id,
        faena_id: usuario.faena_id,
      },
      jwtSecret,
      {
        expiresIn: '4h',
      }
    );

    res.status(200).json({
      mensaje: '✅ Autenticación exitosa',
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        rol_id: usuario.rol_id,
        faena_id: usuario.faena_id,
      },
    });
  } catch (error) {
    console.error('Error interno en login:', error);

    res.status(500).json({
      mensaje: 'Error interno en login',
    });
  }
};
