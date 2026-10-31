import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/models', () => ({
  Documento: {
    findByPk: vi.fn(),
  },
  RelDocumentoUsuario: {},
  Usuario: {},
  FirmaDigital: {},
}));

vi.mock('../src/services/coordinadorAsignacionesDocumentales.service', () => ({
  ejecutarAsignacionDocumental: vi.fn(),
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
import { ejecutarAsignacionDocumental } from '../src/services/coordinadorAsignacionesDocumentales.service';
import { ErrorAsignacionDocumental } from '../src/services/asignacionDocumental.service';
import { asignarDocumentoAUsuario } from '../src/controllers/rel_documentos_usuarios.controller';

describe('HTTP - asignaciones documentales seguras', () => {
  const app = express();

  app.use(express.json());

  app.post('/asignaciones', (req, _res, next) => {
    (req as any).usuario = { id: 2, rol_id: 1 };
    next();
  }, asignarDocumentoAUsuario);

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Documento.findByPk).mockResolvedValue({
      id: 8,
      nombre: 'Uso de extintores',
    } as any);
  });

  const solicitud = {
    documento_id: 8,
    asignacion_tipo: 'usuarios',
    usuario_ids: [31],
  };

  it('registra una asignación nueva', async () => {
    vi.mocked(ejecutarAsignacionDocumental).mockResolvedValue([31]);

    const respuesta = await request(app)
      .post('/asignaciones')
      .send(solicitud);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.asignaciones_nuevas).toBe(1);

    expect(ejecutarAsignacionDocumental).toHaveBeenCalledWith({
      administradorId: 2,
      documentoId: 8,
      nombreDocumento: 'Uso de extintores',
      asignacionTipo: 'usuarios',
      usuarioIds: [31],
      rolId: undefined,
    });
  });

  it('reconoce una asignación existente sin crear otra', async () => {
    vi.mocked(ejecutarAsignacionDocumental).mockResolvedValue([]);

    const respuesta = await request(app)
      .post('/asignaciones')
      .send(solicitud);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.asignaciones_nuevas).toBe(0);
  });

  it('rechaza destinatarios no autorizados', async () => {
    vi.mocked(ejecutarAsignacionDocumental).mockRejectedValue(
      new ErrorAsignacionDocumental(
        403,
        'Destinatarios de otra empresa.'
      )
    );

    const respuesta = await request(app)
      .post('/asignaciones')
      .send(solicitud);

    expect(respuesta.status).toBe(403);
    expect(respuesta.body.mensaje).toContain('otra empresa');
  });

  it('rechaza documentos inexistentes sin ejecutar asignaciones', async () => {
    vi.mocked(Documento.findByPk).mockResolvedValue(null);

    const respuesta = await request(app)
      .post('/asignaciones')
      .send(solicitud);

    expect(respuesta.status).toBe(404);
    expect(ejecutarAsignacionDocumental).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de documento inválidos', async () => {
    const respuesta = await request(app)
      .post('/asignaciones')
      .send({
        ...solicitud,
        documento_id: 'abc',
      });

    expect(respuesta.status).toBe(400);
    expect(Documento.findByPk).not.toHaveBeenCalled();
  });
});
