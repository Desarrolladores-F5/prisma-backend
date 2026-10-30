import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/models', () => ({
  RelDocumentoUsuario: {
    findOne: vi.fn(),
  },
  Usuario: {},
  Documento: {},
  FirmaDigital: {},
}));

vi.mock('../src/utils/pdf', () => ({
  generarPDFConfirmacion: vi.fn(),
}));

import { RelDocumentoUsuario } from '../src/models';
import { generarPDFConfirmacion } from '../src/utils/pdf';
import { validarToken } from '../src/middlewares/validarToken';
import { confirmarRecepcionDocumento } from '../src/controllers/documento.controller';

describe('Seguridad - aceptación expresa documental', () => {
  const secreto = 'clave-exclusiva-prueba-aceptacion';
  const secretoAnterior = process.env.JWT_SECRET;

  const app = express();
  app.use(express.json());

  app.put(
    '/api/documentos/recepcionar/:documentoId',
    validarToken,
    confirmarRecepcionDocumento
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

  it('permite confirmar recepción con aceptación expresa', async () => {
    const guardar = vi.fn().mockResolvedValue(undefined);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      usuario_id: 12,
      documento_id: 45,
      recepcionado: false,
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      documento: {
        nombre: 'Documento de prueba',
        tipo: 'Procedimiento',
      },
      save: guardar,
    } as any);

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(
      '/uploads/confirmaciones/constancia-ficticia.pdf'
    );

    const respuesta = await request(app)
      .put('/api/documentos/recepcionar/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(200);
    expect(generarPDFConfirmacion).toHaveBeenCalledOnce();
    expect(guardar).toHaveBeenCalledOnce();
  });

  it.each([
    ['sin declaración', undefined],
    ['declaración rechazada', false],
  ])('impide confirmar recepción %s', async (_caso, aceptacion) => {
    const guardar = vi.fn();

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      usuario_id: 12,
      documento_id: 45,
      recepcionado: false,
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      documento: {
        nombre: 'Documento de prueba',
        tipo: 'Procedimiento',
      },
      save: guardar,
    } as any);

    const cuerpo = aceptacion === undefined
      ? {}
      : { acepta_declaracion: aceptacion };

    const respuesta = await request(app)
      .put('/api/documentos/recepcionar/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send(cuerpo);

    expect(respuesta.status).toBe(400);
    expect(generarPDFConfirmacion).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
  });
});
