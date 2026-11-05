import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/models', () => ({
  Documento: {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    destroy: vi.fn(),
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

  return {
    ErrorAsignacionDocumental,
    obtenerEmpresaAdministrador: vi.fn(),
  };
});

vi.mock('../src/services/recepcionDocumental.service', () => ({
  confirmarRecepcionDocumental: vi.fn(),
  ErrorRecepcionDocumental: class extends Error {},
}));

import { Documento } from '../src/models';
import { crearDocumentoConAsignaciones } from '../src/services/creacionDocumental.service';
import {
  obtenerEmpresaAdministrador,
  ErrorAsignacionDocumental,
} from '../src/services/asignacionDocumental.service';

import {
  crearDocumento,
  obtenerDocumentos,
  obtenerDocumentoPorId,
  actualizarDocumento,
  eliminarDocumento,
} from '../src/controllers/documento.controller';

describe('Seguridad multiempresa de documentos', () => {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    (req as any).usuario = { id: 2, rol_id: 1 };
    next();
  });

  app.get('/documentos', obtenerDocumentos);
  app.get('/documentos/:id', obtenerDocumentoPorId);
  app.post('/documentos', crearDocumento);
  app.patch('/documentos/:id', actualizarDocumento);
  app.delete('/documentos/:id', eliminarDocumento);

  const datos = {
    nombre: 'PRUEBA DE NOTIFICACIONES - PRISMA',
    tipo: 'application/pdf',
    url: '/uploads/prueba-notificaciones.pdf',
    version: '1.0',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValue(1);
    vi.mocked(Documento.findAll).mockResolvedValue([] as any);

    vi.mocked(Documento.create).mockResolvedValue({
      id: 88,
      empresa_id: 1,
      ...datos,
    } as any);

    vi.mocked(crearDocumentoConAsignaciones).mockResolvedValue({
      id: 88,
      empresa_id: 1,
      ...datos,
    } as any);

    vi.mocked(Documento.findOne).mockResolvedValue(null);
    vi.mocked(Documento.destroy).mockResolvedValue(0);
  });

  it('lista únicamente los documentos de la empresa del administrador', async () => {
    const respuesta = await request(app).get('/documentos');

    expect(respuesta.status).toBe(200);
    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(2);

    expect(Documento.findAll).toHaveBeenCalledWith({
      where: { empresa_id: 1 },
    });
  });

  it('permite registrar un documento sin asignarlo todavía', async () => {
    const respuesta = await request(app).post('/documentos').send(datos);

    expect(respuesta.status).toBe(201);
    expect(Documento.create).toHaveBeenCalledOnce();
    expect(crearDocumentoConAsignaciones).not.toHaveBeenCalled();
  });

  it('asocia el documento sin asignaciones a la empresa del administrador', async () => {
    const respuesta = await request(app).post('/documentos').send({
      ...datos,
      empresa_id: 999,
    });

    expect(respuesta.status).toBe(201);
    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(2);

    expect(Documento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        empresa_id: 1,
      })
    );
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

  it('no crea documentos cuando no puede identificar la empresa', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockRejectedValue(
      new ErrorAsignacionDocumental(403, 'Empresa no identificada')
    );

    const respuesta = await request(app).post('/documentos').send(datos);

    expect(respuesta.status).toBe(403);
    expect(Documento.create).not.toHaveBeenCalled();
  });

  it('consulta un documento únicamente dentro de la empresa autorizada', async () => {
    vi.mocked(Documento.findOne).mockResolvedValue({
      id: 88,
      empresa_id: 1,
      ...datos,
    } as any);

    const respuesta = await request(app).get('/documentos/88');

    expect(respuesta.status).toBe(200);

    expect(Documento.findOne).toHaveBeenCalledWith({
      where: {
        id: '88',
        empresa_id: 1,
      },
    });
  });

  it('impide consultar un documento perteneciente a otra empresa', async () => {
    const respuesta = await request(app).get('/documentos/99');

    expect(respuesta.status).toBe(404);
    expect(Documento.findOne).toHaveBeenCalledWith({
      where: {
        id: '99',
        empresa_id: 1,
      },
    });
  });

  it('actualiza documentos pertenecientes a la empresa autorizada', async () => {
    const actualizar = vi.fn().mockResolvedValue(undefined);

    vi.mocked(Documento.findOne).mockResolvedValue({
      id: 88,
      empresa_id: 1,
      update: actualizar,
    } as any);

    const respuesta = await request(app)
      .patch('/documentos/88')
      .send({ nombre: 'Documento actualizado' });

    expect(respuesta.status).toBe(200);

    expect(Documento.findOne).toHaveBeenCalledWith({
      where: {
        id: '88',
        empresa_id: 1,
      },
    });

    expect(actualizar).toHaveBeenCalledWith({
      nombre: 'Documento actualizado',
    });
  });

  it('impide actualizar documentos pertenecientes a otra empresa', async () => {
    const respuesta = await request(app)
      .patch('/documentos/99')
      .send({ nombre: 'Intento de modificación' });

    expect(respuesta.status).toBe(404);
    expect(Documento.findOne).toHaveBeenCalledWith({
      where: {
        id: '99',
        empresa_id: 1,
      },
    });
  });

  it('elimina documentos únicamente de la empresa autorizada', async () => {
    vi.mocked(Documento.destroy).mockResolvedValue(1);

    const respuesta = await request(app).delete('/documentos/88');

    expect(respuesta.status).toBe(200);

    expect(Documento.destroy).toHaveBeenCalledWith({
      where: {
        id: '88',
        empresa_id: 1,
      },
    });
  });

  it('impide eliminar documentos pertenecientes a otra empresa', async () => {
    const respuesta = await request(app).delete('/documentos/99');

    expect(respuesta.status).toBe(404);

    expect(Documento.destroy).toHaveBeenCalledWith({
      where: {
        id: '99',
        empresa_id: 1,
      },
    });
  });
});
