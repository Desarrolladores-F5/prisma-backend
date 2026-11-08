import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/models', () => ({
  RespuestaFormulario: {
    findByPk: vi.fn(),
  },
  Usuario: {},
  Formulario: {},
}));

import { RespuestaFormulario } from '../src/models';
import { validarToken } from '../src/middlewares/validarToken';
import { obtenerRespuestaPorId } from '../src/controllers/respuesta_formulario.controller';

describe('Seguridad - acceso a respuestas de formularios', () => {
  const secreto = 'clave-exclusiva-pruebas-prisma-segura-2026';
  const secretoAnterior = process.env.JWT_SECRET;

  const app = express();

  app.get(
    '/api/respuestas-formulario/:id',
    validarToken,
    obtenerRespuestaPorId
  );

  const tokenTrabajador = jwt.sign(
    { id: 12, rol_id: 3 },
    secreto,
    { expiresIn: '1h' }
  );

  beforeEach(() => {
    process.env.JWT_SECRET = secreto;
    vi.clearAllMocks();
  });

  afterAll(() => {
    if (secretoAnterior === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = secretoAnterior;
    }
  });

  it('rechaza solicitudes sin token', async () => {
    const respuesta = await request(app)
      .get('/api/respuestas-formulario/25');

    expect(respuesta.status).toBe(401);
    expect(RespuestaFormulario.findByPk).not.toHaveBeenCalled();
  });

  it('permite consultar una respuesta propia', async () => {
    vi.mocked(RespuestaFormulario.findByPk).mockResolvedValueOnce({
      id: 25,
      usuario_id: 12,
      respuestas_json: { conforme: true },
    } as any);

    const respuesta = await request(app)
      .get('/api/respuestas-formulario/25')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.usuario_id).toBe(12);
  });

  it('impide consultar una respuesta de otro usuario', async () => {
    vi.mocked(RespuestaFormulario.findByPk).mockResolvedValueOnce({
      id: 25,
      usuario_id: 15,
      respuestas_json: { conforme: true },
    } as any);

    const respuesta = await request(app)
      .get('/api/respuestas-formulario/25')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(403);
  });
});
