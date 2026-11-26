import express from 'express';
import jwt from 'jsonwebtoken';
import { QueryTypes } from 'sequelize';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  open: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('../src/models', () => ({
  sequelize: { query: vi.fn() },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
  ErrorAsignacionDocumental: class extends Error {},
}));

import { mkdir, open, unlink } from 'node:fs/promises';
import { sequelize } from '../src/models';
import { obtenerEmpresaAdministrador } from '../src/services/asignacionDocumental.service';
import requisitosRoutes from '../src/routes/requisitosDocumentalesExternos.routes';

const app = express();
app.use(express.json());
app.use('/api/contratos-externos', requisitosRoutes);

const consultar = vi.mocked(sequelize.query);
const resolverMandante = vi.mocked(obtenerEmpresaAdministrador);
const crearDirectorio = vi.mocked(mkdir);
const abrirArchivo = vi.mocked(open);
const eliminarArchivo = vi.mocked(unlink);

const token = () => jwt.sign(
  { id: 11, rol_id: 1 },
  process.env.JWT_SECRET!
);

const ruta = (contratoId: number) =>
  `/api/contratos-externos/${contratoId}/requisitos`;

describe('HTTP - Plantillas opcionales de la mandante', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    resolverMandante.mockResolvedValue(1);
    crearDirectorio.mockResolvedValue(undefined);
    eliminarArchivo.mockResolvedValue(undefined);

    abrirArchivo.mockResolvedValue({
      writeFile: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof open>>);
  });

  it('crea una solicitud con un PDF adjunto', async () => {
    consultar
      .mockImplementationOnce(async () => [{ id: 10 }])
      .mockImplementationOnce(async () => [71, 1]);

    const respuesta = await request(app)
      .post(ruta(10))
      .set('Authorization', 'Bearer ' + token())
      .field('nombre', 'Declaración de seguridad')
      .attach(
        'archivo',
        Buffer.from('%PDF-1.7\nDocumento de prueba'),
        'declaracion.pdf'
      );

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toEqual({
      id: 71,
      contratoId: 10,
      nombre: 'Declaración de seguridad',
      tienePlantilla: true,
    });

    expect(consultar).toHaveBeenCalledTimes(2);

    expect(consultar).toHaveBeenLastCalledWith(
      expect.stringContaining('plantilla_archivo_url'),
      expect.objectContaining({
        type: QueryTypes.INSERT,
        replacements: expect.objectContaining({
          contratoId: 10,
          mandanteId: 1,
          nombre: 'Declaración de seguridad',
          plantillaNombre: 'declaracion.pdf',
          plantillaUrl: expect.stringMatching(
            /^privado:plantillas-externas\/[a-f0-9-]+\.pdf$/
          ),
        }),
      })
    );

    expect(crearDirectorio).toHaveBeenCalledOnce();
    expect(abrirArchivo).toHaveBeenCalledOnce();
  });

  it('permite crear una solicitud multipart sin adjuntar archivo', async () => {
    consultar
      .mockImplementationOnce(async () => [{ id: 10 }])
      .mockImplementationOnce(async () => [72, 1]);

    const respuesta = await request(app)
      .post(ruta(10))
      .set('Authorization', 'Bearer ' + token())
      .field('nombre', 'Certificado de capacitación');

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toEqual({
      id: 72,
      contratoId: 10,
      nombre: 'Certificado de capacitación',
    });

    expect(abrirArchivo).not.toHaveBeenCalled();
    expect(crearDirectorio).not.toHaveBeenCalled();
  });

  it('elimina el archivo cuando el contrato deja de estar disponible antes del INSERT', async () => {
    consultar
      .mockImplementationOnce(async () => [{ id: 10 }])
      .mockImplementationOnce(async () => [0, 0]);

    const respuesta = await request(app)
      .post(ruta(10))
      .set('Authorization', 'Bearer ' + token())
      .field('nombre', 'Documento con contrato no disponible')
      .attach(
        'archivo',
        Buffer.from('%PDF-1.7\\nDocumento de prueba'),
        'documento.pdf'
      );

    expect(respuesta.status).toBe(404);
    expect(abrirArchivo).toHaveBeenCalledOnce();
    expect(eliminarArchivo).toHaveBeenCalledOnce();
  });

  it('conserva el archivo si el resultado del INSERT es incierto', async () => {
    consultar
      .mockImplementationOnce(async () => [{ id: 10 }])
      .mockRejectedValueOnce(new Error('Conexión perdida durante el INSERT'));

    const registrarError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const respuesta = await request(app)
        .post(ruta(10))
        .set('Authorization', 'Bearer ' + token())
        .field('nombre', 'Declaración de seguridad')
        .attach(
          'archivo',
          Buffer.from('%PDF-1.7\\nDocumento de prueba'),
          'declaracion.pdf'
        );

      expect(respuesta.status).toBe(500);
      expect(abrirArchivo).toHaveBeenCalledOnce();
      expect(eliminarArchivo).not.toHaveBeenCalled();
    } finally {
      registrarError.mockRestore();
    }
  });

  it('rechaza un contrato ajeno antes de procesar el adjunto', async () => {
    consultar.mockImplementationOnce(async () => []);

    const respuesta = await request(app)
      .post(ruta(20))
      .set('Authorization', 'Bearer ' + token())
      .field('nombre', 'Documento ajeno')
      .attach(
        'archivo',
        Buffer.from('%PDF-1.7\nDocumento de prueba'),
        'ajeno.pdf'
      );

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.mensaje).toBe(
      'Contrato no disponible para esta mandante.'
    );

    expect(consultar).toHaveBeenCalledTimes(1);
    expect(abrirArchivo).not.toHaveBeenCalled();
    expect(crearDirectorio).not.toHaveBeenCalled();
  });
});
