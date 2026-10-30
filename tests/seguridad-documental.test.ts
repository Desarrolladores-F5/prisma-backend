import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/models', () => ({
  RelDocumentoUsuario: {
    findAll: vi.fn().mockResolvedValue([]),
  },
  Usuario: {},
  Documento: {},
  FirmaDigital: {},
}));

vi.mock('../src/utils/pdf', () => ({
  generarPDFConfirmacion: vi.fn(),
}));

import { RelDocumentoUsuario } from '../src/models';
import { validarToken } from '../src/middlewares/validarToken';
import { obtenerDocumentosPorUsuario } from '../src/controllers/rel_documentos_usuarios.controller';

describe('Seguridad documental - consulta de asignaciones', () => {
  const secreto = 'clave-exclusiva-pruebas-prisma';

  const app = express();
  app.get(
    '/api/rel-documentos-usuarios/:usuario_id',
    validarToken,
    obtenerDocumentosPorUsuario
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

  it('rechaza solicitudes sin token', async () => {
    const respuesta = await request(app)
      .get('/api/rel-documentos-usuarios/12');

    expect(respuesta.status).toBe(401);
    expect(RelDocumentoUsuario.findAll).not.toHaveBeenCalled();
  });

  it('permite consultar documentos propios', async () => {
    const respuesta = await request(app)
      .get('/api/rel-documentos-usuarios/12')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(200);
    expect(RelDocumentoUsuario.findAll).toHaveBeenCalled();
  });

  it('impide consultar documentos de otro trabajador', async () => {
    const respuesta = await request(app)
      .get('/api/rel-documentos-usuarios/15')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(403);
    expect(RelDocumentoUsuario.findAll).not.toHaveBeenCalled();
  });
});
