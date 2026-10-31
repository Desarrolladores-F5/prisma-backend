import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/controllers/rel_documentos_usuarios.controller', () => ({
  asignarDocumentoAUsuario: vi.fn((_req, res) => {
    res.status(201).json({ mensaje: 'Asignación simulada' });
  }),
  obtenerDocumentosPorUsuario: vi.fn(),
  eliminarAsignacionDocumentoUsuario: vi.fn(),
  obtenerConfirmacionesPorDocumento: vi.fn(),
  confirmarRecepcion: vi.fn(),
  descargarConstancia: vi.fn(),
}));

import router from '../src/routes/rel_documentos_usuarios.routes';
import { asignarDocumentoAUsuario } from '../src/controllers/rel_documentos_usuarios.controller';

describe('Autorización HTTP de asignaciones documentales', () => {
  const app = express();
  app.use(express.json());
  app.use('/rel-documentos-usuarios', router);

  const token = (id: number, rol_id: number) =>
    jwt.sign(
      { id, rol_id },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .post('/rel-documentos-usuarios')
      .send({ documento_id: 8 });

    expect(respuesta.status).toBe(401);
    expect(asignarDocumentoAUsuario).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes de trabajadores', async () => {
    const respuesta = await request(app)
      .post('/rel-documentos-usuarios')
      .set('Authorization', `Bearer ${token(31, 3)}`)
      .send({ documento_id: 8 });

    expect(respuesta.status).toBe(403);
    expect(asignarDocumentoAUsuario).not.toHaveBeenCalled();
  });

  it('permite solicitudes de administradores autenticados', async () => {
    const respuesta = await request(app)
      .post('/rel-documentos-usuarios')
      .set('Authorization', `Bearer ${token(2, 1)}`)
      .send({ documento_id: 8 });

    expect(respuesta.status).toBe(201);
    expect(asignarDocumentoAUsuario).toHaveBeenCalledOnce();
  });
});
