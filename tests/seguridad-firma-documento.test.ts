import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/models', () => ({
  FirmaDigital: {
    create: vi.fn(),
  },
  RespuestaFormulario: {
    update: vi.fn(),
  },
  RelDocumentoUsuario: {
    findOne: vi.fn(),
    update: vi.fn(),
  },
}));

import { FirmaDigital, RelDocumentoUsuario } from '../src/models';
import { validarToken } from '../src/middlewares/validarToken';
import { crearFirma } from '../src/controllers/firma_digital.controller';

describe('Seguridad - autorización para firmar documentos', () => {
  const secreto = 'clave-exclusiva-pruebas-documentales';
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

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValue(null);
  });

  afterAll(() => {
    if (secretoAnterior === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = secretoAnterior;
    }
  });

  it('impide firmar un documento no asignado al trabajador', async () => {
    const respuesta = await request(app)
      .post('/api/firmas')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({
        firmante_id: 12,
        hash_firma: 'hash-de-prueba',
        tipo_firma: 'firma_documento',
        metadata: {
          entidad: 'documento',
          entidad_id: 45,
        },
      });

    expect(respuesta.status).toBe(403);
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(RelDocumentoUsuario.update).not.toHaveBeenCalled();
  });

  it('permite firmar un documento asignado al trabajador', async () => {
    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      documento_id: 45,
      usuario_id: 12,
    } as any);

    vi.mocked(FirmaDigital.create).mockResolvedValueOnce({
      id: 99,
      firmante_id: 12,
    } as any);

    vi.mocked(RelDocumentoUsuario.update).mockResolvedValueOnce([1] as any);

    const respuesta = await request(app)
      .post('/api/firmas')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({
        firmante_id: 12,
        hash_firma: 'hash-de-prueba',
        tipo_firma: 'firma_documento',
        metadata: {
          entidad: 'documento',
          entidad_id: 45,
        },
      });

    expect(respuesta.status).toBe(201);

    expect(RelDocumentoUsuario.findOne).toHaveBeenCalledWith({
      where: {
        documento_id: 45,
        usuario_id: 12,
      },
    });

    expect(FirmaDigital.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firmante_id: 12,
      })
    );

    // Crear una firma no debe confirmar automáticamente la recepción.
    expect(RelDocumentoUsuario.update).not.toHaveBeenCalled();
  });


  it('rechaza una firma documental con entidad manipulada', async () => {
    const respuesta = await request(app)
      .post('/api/firmas')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({
        firmante_id: 12,
        hash_firma: 'hash-de-prueba',
        tipo_firma: 'firma_documento',
        metadata: {
          entidad: 'otra_entidad',
          entidad_id: 45,
        },
      });

    expect(respuesta.status).toBe(400);
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(RelDocumentoUsuario.update).not.toHaveBeenCalled();
  });

});
