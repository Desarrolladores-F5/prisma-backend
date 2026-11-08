import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface RequestConUsuario extends Request {
  usuario?: any;
}

export const validarToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authorization = req.header('Authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : undefined;

  if (!token) {
    res.status(401).json({
      mensaje: 'Token no proporcionado',
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

  try {
    const decoded = jwt.verify(token, jwtSecret);

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.id !== 'number' ||
      typeof decoded.rol_id !== 'number'
    ) {
      res.status(401).json({
        mensaje: 'Token inválido',
      });
      return;
    }

    (req as RequestConUsuario).usuario = decoded;
    next();
  } catch {
    res.status(401).json({
      mensaje: 'Token inválido o expirado',
    });
  }
};

export const esAdministrador = (
  req: RequestConUsuario,
  res: Response,
  next: NextFunction
): void => {
  if (req.usuario?.rol_id !== 1) {
    res.status(403).json({
      mensaje: 'Acceso denegado: se requiere rol administrador',
    });
    return;
  }

  next();
};
