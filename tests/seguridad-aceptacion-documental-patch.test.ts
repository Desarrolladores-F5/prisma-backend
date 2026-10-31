import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/models', () => ({
  RelDocumentoUsuario: {},
  Usuario: {},
  Documento: {},
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
import { confirmarRecepcion } from '../src/controllers/rel_documentos_usuarios.controller';

describe('Seguridad - aceptación documental PATCH', () => {
  const secreto = 'clave-exclusiva-pruebas-patch';
  const secretoAnterior = process.env.JWT_SECRET;
  const ruta = '/api/rel-documentos-usuarios/confirmar/45';
  const constancia = '/uploads/confirmaciones/constancia-ficticia.pdf';

  const app = express();
  app.use(express.json());
  app.patch('/api/rel-documentos-usuarios/confirmar/:documento_id', validarToken, confirmarRecepcion);

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

  it.each([
    ['sin aceptación', {}],
    ['aceptación rechazada', { acepta_declaracion: false }],
    ['aceptación como texto', { acepta_declaracion: 'true' }],
  ])('rechaza confirmación %s', async (_caso, cuerpo) => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send(cuerpo);

    expect(respuesta.status).toBe(400);
    expect(confirmarRecepcionDocumental).not.toHaveBeenCalled();
  });

  it('permite confirmar con aceptación expresa', async () => {
    vi.mocked(confirmarRecepcionDocumental).mockResolvedValueOnce({
      ruta_constancia_pdf: constancia,
    });

    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.ruta_constancia_pdf).toBe(constancia);
    expect(respuesta.body.constancia_url).toBe(constancia);
    expect(confirmarRecepcionDocumental).toHaveBeenCalledExactlyOnceWith({
      documentoId: 45,
      usuarioId: 12,
      aceptaDeclaracion: true,
    });
  });

  it('impide confirmar nuevamente un documento recepcionado', async () => {
    vi.mocked(confirmarRecepcionDocumental).mockRejectedValueOnce(
      new ErrorRecepcionDocumental(409, 'El documento ya fue recepcionado.')
    );

    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(409);
    expect(confirmarRecepcionDocumental).toHaveBeenCalledOnce();
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(401);
    expect(confirmarRecepcionDocumental).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de documento inválidos', async () => {
    const respuesta = await request(app)
      .patch('/api/rel-documentos-usuarios/confirmar/abc')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(400);
    expect(confirmarRecepcionDocumental).not.toHaveBeenCalled();
  });
});
