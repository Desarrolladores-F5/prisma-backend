import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/models', () => ({
  Documento: {},
  RelDocumentoUsuario: {},
  Usuario: {},
  FirmaDigital: {},
}));

vi.mock('../src/services/recepcionDocumental.service', () => {
  class ErrorRecepcionDocumental extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorRecepcionDocumental';
    }
  }

  return {
    confirmarRecepcionDocumental: vi.fn(),
    ErrorRecepcionDocumental,
  };
});

import {
  confirmarRecepcionDocumental,
  ErrorRecepcionDocumental,
} from '../src/services/recepcionDocumental.service';
import { validarToken } from '../src/middlewares/validarToken';
import { confirmarRecepcionDocumento } from '../src/controllers/documento.controller';

describe('Seguridad - aceptación expresa documental PUT', () => {
  const secreto = 'clave-exclusiva-prueba-aceptacion';
  const secretoAnterior = process.env.JWT_SECRET;
  const ruta = '/api/documentos/recepcionar/45';
  const constancia = '/uploads/confirmaciones/constancia-ficticia.pdf';

  const app = express();
  app.use(express.json());
  app.put('/api/documentos/recepcionar/:documentoId', validarToken, confirmarRecepcionDocumento);

  const tokenTrabajador = jwt.sign(
    { id: 12, rol_id: 3 },
    secreto,
    { expiresIn: '1h' }
  );

  beforeEach(() => {
    process.env.JWT_SECRET = secreto;
    vi.resetAllMocks();
  });

  afterAll(() => {
    if (secretoAnterior === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = secretoAnterior;
    }
  });

  it('permite confirmar recepción con aceptación expresa', async () => {
    vi.mocked(confirmarRecepcionDocumental).mockResolvedValueOnce({
      ruta_constancia_pdf: constancia,
    });

    const respuesta = await request(app)
      .put(ruta)
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.constancia_url).toBe(constancia);
    expect(respuesta.body.ruta_constancia_pdf).toBe(constancia);
    expect(confirmarRecepcionDocumental).toHaveBeenCalledExactlyOnceWith({
      documentoId: 45,
      usuarioId: 12,
      aceptaDeclaracion: true,
    });
  });

  it.each([
    ['sin declaración', {}],
    ['declaración rechazada', { acepta_declaracion: false }],
    ['declaración como texto', { acepta_declaracion: 'true' }],
  ])('impide confirmar recepción %s', async (_caso, cuerpo) => {
    const respuesta = await request(app)
      .put(ruta)
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send(cuerpo);

    expect(respuesta.status).toBe(400);
    expect(confirmarRecepcionDocumental).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .put(ruta)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(401);
    expect(confirmarRecepcionDocumental).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de documento inválidos', async () => {
    const respuesta = await request(app)
      .put('/api/documentos/recepcionar/abc')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(400);
    expect(confirmarRecepcionDocumental).not.toHaveBeenCalled();
  });

  it('devuelve 409 cuando el servicio detecta una recepción duplicada', async () => {
    vi.mocked(confirmarRecepcionDocumental).mockRejectedValueOnce(
      new ErrorRecepcionDocumental(409, 'El documento ya fue recepcionado.')
    );

    const respuesta = await request(app)
      .put(ruta)
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(409);
    expect(confirmarRecepcionDocumental).toHaveBeenCalledOnce();
  });
});
