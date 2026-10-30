import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';

vi.mock('../src/models', () => ({
  RelDocumentoUsuario: {
    findByPk: vi.fn(),
  },
  Usuario: {},
  Documento: {},
  FirmaDigital: {},
}));

vi.mock('../src/utils/pdf', () => ({
  generarPDFConfirmacion: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();

  const lstatSimulado = vi.fn();

  return {
    ...original,
    promises: {
      ...original.promises,
      lstat: lstatSimulado,
    },
    default: {
      ...original,
      promises: {
        ...original.promises,
        lstat: lstatSimulado,
      },
    },
  };
});

import { RelDocumentoUsuario } from '../src/models';
import { validarToken } from '../src/middlewares/validarToken';
import { descargarConstancia } from '../src/controllers/rel_documentos_usuarios.controller';

describe('Seguridad - descarga autorizada de constancias', () => {
  const secreto = 'clave-exclusiva-pruebas-descarga';
  const secretoAnterior = process.env.JWT_SECRET;

  const app = express();

  app.get('/api/constancias/:id', validarToken, descargarConstancia);

  const tokenTrabajador = jwt.sign(
    { id: 12, rol_id: 3 },
    secreto,
    { expiresIn: '1h' }
  );

  const tokenAdministrador = jwt.sign(
    { id: 1, rol_id: 1 },
    secreto,
    { expiresIn: '1h' }
  );

  const constancia = {
    id: 45,
    usuario_id: 12,
    recepcionado: true,
    ruta_constancia_pdf: '/uploads/confirmaciones/constancia-prueba.pdf',
  };

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

  it('rechaza identificadores de asignación inválidos', async () => {
    const respuesta = await request(app)
      .get('/api/constancias/abc')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(400);
    expect(RelDocumentoUsuario.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza asignaciones inexistentes', async () => {
    vi.mocked(RelDocumentoUsuario.findByPk).mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .get('/api/constancias/999')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(404);
  });

  it('rechaza constancias sin archivo registrado', async () => {
    vi.mocked(RelDocumentoUsuario.findByPk).mockResolvedValueOnce({
      id: 45,
      usuario_id: 12,
      recepcionado: true,
      ruta_constancia_pdf: null,
    } as any);

    const respuesta = await request(app)
      .get('/api/constancias/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(404);
  });

  it.each([
    '/uploads/otros/documento.pdf',
    '/uploads/confirmaciones/archivo.txt',
    '/uploads/confirmaciones/archivo.pdf/otro.pdf',
    '/uploads/confirmaciones/../privado.pdf',
    '/uploads/confirmaciones/archivo\\\\peligroso.pdf',
  ])('rechaza rutas de constancias manipuladas: %s', async (ruta) => {
    vi.mocked(RelDocumentoUsuario.findByPk).mockResolvedValueOnce({
      id: 45,
      usuario_id: 12,
      recepcionado: true,
      ruta_constancia_pdf: ruta,
    } as any);

    const respuesta = await request(app)
      .get('/api/constancias/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(400);
    expect(fs.promises.lstat).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes sin token', async () => {
    const respuesta = await request(app).get('/api/constancias/45');

    expect(respuesta.status).toBe(401);
    expect(RelDocumentoUsuario.findByPk).not.toHaveBeenCalled();
  });

  it('impide descargar la constancia de otro trabajador', async () => {
    vi.mocked(RelDocumentoUsuario.findByPk).mockResolvedValueOnce({
      ...constancia,
      usuario_id: 15,
    } as any);

    const respuesta = await request(app)
      .get('/api/constancias/45')
      .set('Authorization', `Bearer ${tokenTrabajador}`);

    expect(respuesta.status).toBe(403);
  });

  it.each([
    ['trabajador propietario', tokenTrabajador],
    ['administrador', tokenAdministrador],
  ])('autoriza la descarga para %s', async (_perfil, token) => {
    vi.mocked(RelDocumentoUsuario.findByPk).mockResolvedValueOnce(
      constancia as any
    );

    vi.mocked(fs.promises.lstat).mockResolvedValueOnce({
      isFile: () => true,
      isSymbolicLink: () => false,
    } as any);

    const appSimulada = express();
    appSimulada.response.sendFile = function (_ruta: any, _opciones: any, callback: any) {
      this.status(200).end();
      if (typeof callback === 'function') callback();
      return this;
    } as any;

    appSimulada.get('/api/constancias/:id', validarToken, descargarConstancia);

    const respuesta = await request(appSimulada)
      .get('/api/constancias/45')
      .set('Authorization', `Bearer ${token}`);

    if (respuesta.status !== 200) {
      console.log('Diagnóstico de descarga:', {
        perfil: _perfil,
        estado: respuesta.status,
        respuesta: respuesta.body,
        consultaAsignacion: vi.mocked(RelDocumentoUsuario.findByPk).mock.calls,
        consultaArchivo: vi.mocked(fs.promises.lstat).mock.calls,
      });
    }

    expect(respuesta.status).toBe(200);
    expect(RelDocumentoUsuario.findByPk).toHaveBeenCalledWith(45);
  });
});
