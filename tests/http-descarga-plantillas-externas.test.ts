import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  open: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('../src/models', () => ({
  sequelize: { query: vi.fn() },
  Documento: {},
}));

vi.mock('../src/services/autorizacionEmpresasExternas.service', () => ({
  autorizarAdministradorContratoExterno: vi.fn(),
  ErrorAutorizacionEmpresaExterna: class extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
    }
  },
}));

vi.mock('../src/services/autorizacionPresentacionDocumentalExterna.service', () => ({
  ErrorPresentacionDocumentalExterna: class extends Error {},
}));

vi.mock('../src/services/registroAcreditacionDocumentalExterna.service', () => ({
  registrarAcreditacionDocumentalExterna: vi.fn(),
  ErrorRegistroAcreditacionExterna: class extends Error {},
}));

vi.mock('../src/services/autorizacionRevisionDocumentalExterna.service', () => ({
  autorizarRevisionDocumentalExterna: vi.fn(),
  ErrorAutorizacionRevisionExterna: class extends Error {},
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  ErrorAsignacionDocumental: class extends Error {},
}));

vi.mock('../src/services/notificacionesAutomaticas.service', () => ({
  crearNotificacionesAutomaticas: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { sequelize } from '../src/models';
import {
  autorizarAdministradorContratoExterno,
  ErrorAutorizacionEmpresaExterna,
} from '../src/services/autorizacionEmpresasExternas.service';
import archivosRoutes from '../src/routes/archivosAcreditacionesExternas.routes';

const app = express();
app.use(express.json());
app.use('/api/contratos-externos', archivosRoutes);

const consultar = vi.mocked(sequelize.query);
const autorizar = vi.mocked(autorizarAdministradorContratoExterno);
const leerArchivo = vi.mocked(readFile);

const identificadorArchivo =
  '123e4567-e89b-42d3-a456-426614174000';

const plantilla = {
  plantilla_archivo_url:
    `privado:plantillas-externas/${identificadorArchivo}.pdf`,
  plantilla_nombre_original: 'Declaracion de seguridad.pdf',
};

function token() {
  return jwt.sign(
    { id: 9, rol_id: 1 },
    process.env.JWT_SECRET!
  );
}

function ruta(contratoId = 50, requisitoId = 100) {
  return `/api/contratos-externos/${contratoId}/requisitos/${requisitoId}/plantilla`;
}

describe('HTTP - Descarga privada de plantillas documentales externas', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    autorizar.mockResolvedValue({
      usuarioId: 9,
      empresaId: 3,
      contratoId: 50,
    });

    consultar.mockResolvedValue([plantilla] as any);

    leerArchivo.mockResolvedValue(
      Buffer.from('%PDF-1.7\nPlantilla de prueba')
    );
  });

  it('permite descargar una plantilla de su contrato autorizado', async () => {
    const respuesta = await request(app)
      .get(ruta())
      .set('Authorization', 'Bearer ' + token());

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers['content-type']).toMatch(
      /^application\/pdf/
    );
    expect(respuesta.headers['cache-control']).toBe(
      'private, no-store'
    );
    expect(respuesta.headers['x-content-type-options']).toBe(
      'nosniff'
    );

    expect(respuesta.headers['content-disposition']).toContain(
      'attachment'
    );

    expect(autorizar).toHaveBeenCalledWith(9, 50);

    expect(consultar).toHaveBeenCalledWith(
      expect.stringContaining(
        'c.contratista_empresa_id = :empresaId'
      ),
      expect.objectContaining({
        replacements: {
          requisitoId: 100,
          contratoId: 50,
          empresaId: 3,
        },
      })
    );

    expect(leerArchivo).toHaveBeenCalledOnce();
  });

  it('rechaza a una contratista sin permiso sobre el contrato', async () => {
    autorizar.mockRejectedValue(
      new ErrorAutorizacionEmpresaExterna(
        403,
        'No tiene autorización para administrar este contrato.'
      )
    );

    const respuesta = await request(app)
      .get(ruta())
      .set('Authorization', 'Bearer ' + token());

    expect(respuesta.status).toBe(403);
    expect(consultar).not.toHaveBeenCalled();
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it('no permite descargar un requisito ajeno al contrato', async () => {
    consultar.mockResolvedValue([] as any);

    const respuesta = await request(app)
      .get(ruta())
      .set('Authorization', 'Bearer ' + token());

    expect(respuesta.status).toBe(404);
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it('responde 404 cuando la solicitud no tiene plantilla', async () => {
    consultar.mockResolvedValue([{
      plantilla_archivo_url: null,
      plantilla_nombre_original: null,
    }] as any);

    const respuesta = await request(app)
      .get(ruta())
      .set('Authorization', 'Bearer ' + token());

    expect(respuesta.status).toBe(404);
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it('rechaza referencias privadas con rutas inseguras', async () => {
    consultar.mockResolvedValue([{
      ...plantilla,
      plantilla_archivo_url:
        'privado:plantillas-externas/../../archivo.pdf',
    }] as any);

    const respuesta = await request(app)
      .get(ruta())
      .set('Authorization', 'Bearer ' + token());

    expect(respuesta.status).toBe(404);
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it('rechaza nombres originales con caracteres de ruta', async () => {
    consultar.mockResolvedValue([{
      ...plantilla,
      plantilla_nombre_original: '../archivo.pdf',
    }] as any);

    const respuesta = await request(app)
      .get(ruta())
      .set('Authorization', 'Bearer ' + token());

    expect(respuesta.status).toBe(404);
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it('rechaza identificadores inválidos antes de consultar', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos/abc/requisitos/100/plantilla')
      .set('Authorization', 'Bearer ' + token());

    expect(respuesta.status).toBe(400);
    expect(autorizar).not.toHaveBeenCalled();
    expect(consultar).not.toHaveBeenCalled();
    expect(leerArchivo).not.toHaveBeenCalled();
  });

  it('exige autenticación para descargar la plantilla', async () => {
    const respuesta = await request(app).get(ruta());

    expect(respuesta.status).toBe(401);
    expect(autorizar).not.toHaveBeenCalled();
    expect(consultar).not.toHaveBeenCalled();
    expect(leerArchivo).not.toHaveBeenCalled();
  });
});
