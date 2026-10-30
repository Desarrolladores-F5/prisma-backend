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
  FirmaDigital: {
    create: vi.fn(),
  },
}));

vi.mock('../src/utils/pdf', () => ({
  generarPDFConfirmacion: vi.fn(),
}));

import { RelDocumentoUsuario, FirmaDigital } from '../src/models';
import { generarPDFConfirmacion } from '../src/utils/pdf';
import { validarToken } from '../src/middlewares/validarToken';
import { confirmarRecepcion } from '../src/controllers/rel_documentos_usuarios.controller';

describe('Seguridad - aceptación documental en ruta PATCH', () => {
  const secreto = 'clave-exclusiva-pruebas-patch';
  const secretoAnterior = process.env.JWT_SECRET;

  const app = express();
  app.use(express.json());

  app.patch(
    '/api/rel-documentos-usuarios/confirmar/:documento_id',
    validarToken,
    confirmarRecepcion
  );

  const tokenTrabajador = jwt.sign(
    { id: 12, rol_id: 3 },
    secreto,
    { expiresIn: '1h' }
  );

  beforeEach(() => {
    process.env.JWT_SECRET = secreto;
    vi.clearAllMocks();

    // Eliminar respuestas pendientes de pruebas anteriores.
    vi.mocked(RelDocumentoUsuario.findOne).mockReset();
  });

  afterAll(() => {
    if (secretoAnterior === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = secretoAnterior;
    }
  });

  const prepararRelacion = (recepcionado = false) => {
    const guardar = vi.fn().mockResolvedValue(undefined);

    vi.mocked(RelDocumentoUsuario.findOne).mockResolvedValueOnce({
      id: 8,
      usuario_id: 12,
      documento_id: 45,
      recepcionado,
      documento: {
        nombre: 'Procedimiento de prueba',
        tipo: 'Seguridad',
      },
      usuario: {
        nombre: 'Trabajador',
        apellido: 'Prueba',
        correo: 'prueba@example.test',
      },
      save: guardar,
    } as any);

    return guardar;
  };

  it.each([
    ['sin aceptación', {}],
    ['con aceptación rechazada', { acepta_declaracion: false }],
  ])('rechaza confirmación %s', async (_caso, cuerpo) => {
    const guardar = prepararRelacion();

    const respuesta = await request(app)
      .patch('/api/rel-documentos-usuarios/confirmar/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send(cuerpo);

    expect(respuesta.status).toBe(400);
    expect(generarPDFConfirmacion).not.toHaveBeenCalled();
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
  });

  it('permite confirmar con aceptación expresa', async () => {
    const guardar = prepararRelacion(false);

    vi.mocked(generarPDFConfirmacion).mockResolvedValueOnce(
      '/uploads/confirmaciones/constancia-ficticia.pdf'
    );

    vi.mocked(FirmaDigital.create).mockResolvedValueOnce({
      id: 99,
      firmante_id: 12,
    } as any);

    const respuesta = await request(app)
      .patch('/api/rel-documentos-usuarios/confirmar/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(200);
    expect(generarPDFConfirmacion).toHaveBeenCalledOnce();
    expect(guardar).toHaveBeenCalledOnce();
    expect(FirmaDigital.create).toHaveBeenCalledOnce();
  });

  it('impide confirmar nuevamente un documento recepcionado', async () => {
    const guardar = prepararRelacion(true);

    const respuesta = await request(app)
      .patch('/api/rel-documentos-usuarios/confirmar/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`)
      .send({ acepta_declaracion: true });

    expect(respuesta.status).toBe(409);
    expect(generarPDFConfirmacion).not.toHaveBeenCalled();
    expect(FirmaDigital.create).not.toHaveBeenCalled();
    expect(guardar).not.toHaveBeenCalled();
  });
});
