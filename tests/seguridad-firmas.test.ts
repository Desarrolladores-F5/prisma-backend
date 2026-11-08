import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/models', () => ({
  FirmaDigital: {
    create: vi.fn().mockImplementation(async (datos) => ({
      id: 1,
      ...datos,
    })),
  },
  RespuestaFormulario: {
    update: vi.fn(),
  },
  RelDocumentoUsuario: {
    update: vi.fn(),
  },
}));

import { FirmaDigital } from '../src/models';
import { validarToken } from '../src/middlewares/validarToken';
import { crearFirma } from '../src/controllers/firma_digital.controller';

describe('Seguridad documental - identidad del firmante', () => {
  const secreto = 'clave-exclusiva-pruebas-prisma-segura-2026';
  const secretoAnterior = process.env.JWT_SECRET;

  const app = express();
  app.use(express.json());
  app.post('/api/firmas', validarToken, crearFirma);

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

  const datosFirma = {
    hash_firma: 'hash-de-prueba',
    tipo_firma: 'prueba_seguridad',
    metadata: {
      entidad: 'prueba_seguridad',
    },
  };

  it('rechaza solicitudes sin token', async () => {
    const respuesta = await request(app)
      .post('/api/firmas')
      .send({ ...datosFirma, firmante_id: 12 });

    expect(respuesta.status).toBe(401);
    expect(FirmaDigital.create).not.toHaveBeenCalled();
  });

  it('permite registrar una firma propia', async () => {
    const respuesta = await request(app)
      .post('/api/firmas')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ ...datosFirma, firmante_id: 12 });

    expect(respuesta.status).toBe(201);
    expect(FirmaDigital.create).toHaveBeenCalledWith(
      expect.objectContaining({ firmante_id: 12 })
    );
  });

  it('impide registrar una firma a nombre de otro trabajador', async () => {
    const respuesta = await request(app)
      .post('/api/firmas')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ ...datosFirma, firmante_id: 15 });

    expect(respuesta.status).toBe(403);
    expect(FirmaDigital.create).not.toHaveBeenCalled();
  });
});
