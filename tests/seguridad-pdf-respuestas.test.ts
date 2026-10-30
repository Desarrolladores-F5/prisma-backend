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

vi.mock('pdfkit', () => ({
  default: vi.fn(),
}));

import PDFDocument from 'pdfkit';
import { RespuestaFormulario } from '../src/models';
import { validarToken } from '../src/middlewares/validarToken';
import { descargarPDFRespuesta } from '../src/controllers/respuesta_formulario.controller';

describe('Seguridad - descarga PDF de respuestas', () => {
  const secreto = 'clave-exclusiva-pruebas-prisma-pdf';
  const secretoAnterior = process.env.JWT_SECRET;

  const app = express();
  app.get(
    '/api/respuestas-formulario/pdf/:id',
    validarToken,
    descargarPDFRespuesta
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

  it('rechaza descargas sin token', async () => {
    const respuesta = await request(app)
      .get('/api/respuestas-formulario/pdf/25');

    expect(respuesta.status).toBe(401);
    expect(RespuestaFormulario.findByPk).not.toHaveBeenCalled();
    expect(PDFDocument).not.toHaveBeenCalled();
  });

  it('impide descargar el PDF de una respuesta ajena', async () => {
    vi.mocked(RespuestaFormulario.findByPk).mockResolvedValueOnce({
      id: 25,
      usuario_id: 15,
      respuestas_json: { conforme: true },
      fecha_respuesta: new Date(),
      usuario: { nombre: 'Usuario', apellido: 'Prueba' },
      formulario: { nombre: 'Formulario de prueba' },
    } as any);

    const respuesta = await request(app)
      .get('/api/respuestas-formulario/pdf/25')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(403);
    expect(PDFDocument).not.toHaveBeenCalled();
  });
});
