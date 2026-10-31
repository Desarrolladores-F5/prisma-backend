import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/models', () => ({
  Documento: {
    create: vi.fn(),
  },
  RelDocumentoUsuario: {},
  Usuario: {},
}));

vi.mock('../src/services/creacionDocumental.service', () => ({
  crearDocumentoConAsignaciones: vi.fn(),
}));

vi.mock('../src/services/asignacionDocumental.service', () => {
  class ErrorAsignacionDocumental extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
    }
  }
  return { ErrorAsignacionDocumental };
});

vi.mock('../src/services/recepcionDocumental.service', () => ({
  confirmarRecepcionDocumental: vi.fn(),
  ErrorRecepcionDocumental: class extends Error {},
}));

import { Documento } from '../src/models';
import { crearDocumentoConAsignaciones } from '../src/services/creacionDocumental.service';
import { crearDocumento } from '../src/controllers/documento.controller';

describe('Compatibilidad del formulario de documentos', () => {
  const app = express();
  app.use(express.json());
  app.post('/documentos', (req, _res, next) => {
    (req as any).usuario = { id: 2, rol_id: 1 };
    next();
  }, crearDocumento);

  const datos = {
    nombre: 'PRUEBA DE NOTIFICACIONES - PRISMA',
    tipo: 'application/pdf',
    url: '/uploads/prueba-notificaciones.pdf',
    version: '1.0',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(Documento.create).mockResolvedValue({
      id: 88,
      ...datos,
    } as any);
    vi.mocked(crearDocumentoConAsignaciones).mockResolvedValue({
      id: 88,
      ...datos,
    } as any);
  });

  it('permite registrar un documento sin asignarlo todavía', async () => {
    const respuesta = await request(app).post('/documentos').send(datos);

    expect(respuesta.status).toBe(201);
    expect(Documento.create).toHaveBeenCalledOnce();
    expect(crearDocumentoConAsignaciones).not.toHaveBeenCalled();
  });

  it('devuelve el ID esperado por el formulario para redirigir', async () => {
    const respuesta = await request(app).post('/documentos').send(datos);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.id).toBe(88);
  });

  it('mantiene la creación transaccional cuando se incluyen destinatarios', async () => {
    const respuesta = await request(app).post('/documentos').send({
      ...datos,
      asignacion_tipo: 'usuarios',
      usuario_ids: [31],
    });

    expect(respuesta.status).toBe(201);
    expect(crearDocumentoConAsignaciones).toHaveBeenCalledWith(
      expect.objectContaining({
        administradorId: 2,
        asignacionTipo: 'usuarios',
        usuarioIds: [31],
      })
    );
    expect(Documento.create).not.toHaveBeenCalled();
  });

  it('rechaza rutas de archivo inválidas sin guardar documentos', async () => {
    const respuesta = await request(app).post('/documentos').send({
      ...datos,
      url: '/otro-directorio/prueba.pdf',
    });

    expect(respuesta.status).toBe(400);
    expect(Documento.create).not.toHaveBeenCalled();
    expect(crearDocumentoConAsignaciones).not.toHaveBeenCalled();
  });
});
