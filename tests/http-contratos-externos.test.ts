// tests/http-contratos-externos.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/services/contratosExternos.service', () => {
  class ErrorContratoExterno extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorContratoExterno';
    }
  }

  return {
    crearContratoExterno: vi.fn(),
    ErrorContratoExterno,
  };
});

vi.mock('../src/services/asignacionDocumental.service', () => {
  class ErrorAsignacionDocumental extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorAsignacionDocumental';
    }
  }

  return { ErrorAsignacionDocumental };
});

import router from '../src/routes/contratosExternos.routes';

import {
  crearContratoExterno,
  ErrorContratoExterno,
} from '../src/services/contratosExternos.service';

import {
  ErrorAsignacionDocumental,
} from '../src/services/asignacionDocumental.service';

describe('Seguridad HTTP de contratos externos', () => {
  const app = express();

  app.use(express.json());
  app.use('/api/contratos-externos', router);

  const datosValidos = {
    contratistaEmpresaId: 8,
    faenaId: 4,
    nombre: 'Contrato de mantenimiento',
  };

  const token = (id: number, rol_id: number): string => {
    const secreto = process.env.JWT_SECRET;

    if (!secreto || secreto.length < 32) {
      throw new Error(
        'JWT_SECRET de pruebas no está configurado correctamente.'
      );
    }

    return jwt.sign(
      { id, rol_id },
      secreto,
      { expiresIn: '5m' }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(crearContratoExterno).mockResolvedValue({
      id: 50,
      nombre: 'Contrato de mantenimiento',
    } as Awaited<ReturnType<typeof crearContratoExterno>>);
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .post('/api/contratos-externos')
      .send(datosValidos);

    expect(respuesta.status).toBe(401);
    expect(crearContratoExterno).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes de trabajadores', async () => {
    const respuesta = await request(app)
      .post('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(31, 3)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(403);
    expect(crearContratoExterno).not.toHaveBeenCalled();
  });

  it('rechaza campos empresariales no permitidos', async () => {
    const respuesta = await request(app)
      .post('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(12, 1)}`)
      .send({
        ...datosValidos,
        mandante_empresa_id: 999,
      });

    expect(respuesta.status).toBe(400);
    expect(crearContratoExterno).not.toHaveBeenCalled();
  });

  it('obtiene el administrador exclusivamente del JWT', async () => {
    const respuesta = await request(app)
      .post('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(12, 1)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(201);

    expect(crearContratoExterno).toHaveBeenCalledWith({
      administradorId: 12,
      ...datosValidos,
    });
  });

  it('respeta errores de autorización empresarial', async () => {
    vi.mocked(crearContratoExterno).mockRejectedValueOnce(
      new ErrorAsignacionDocumental(
        403,
        'Administrador sin autorización vigente.'
      )
    );

    const respuesta = await request(app)
      .post('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(12, 1)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(403);
  });

  it('respeta errores de validación del contrato', async () => {
    vi.mocked(crearContratoExterno).mockRejectedValueOnce(
      new ErrorContratoExterno(
        400,
        'Identificadores inválidos.'
      )
    );

    const respuesta = await request(app)
      .post('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(12, 1)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(400);
  });

  it('no expone errores internos al frontend', async () => {
    const errorInterno = new Error('Detalle privado de MySQL');

    vi.mocked(crearContratoExterno).mockRejectedValueOnce(
      errorInterno
    );

    const consola = vi.spyOn(console, 'error').mockImplementation(
      () => undefined
    );

    try {
      const respuesta = await request(app)
        .post('/api/contratos-externos')
        .set('Authorization', `Bearer ${token(12, 1)}`)
        .send(datosValidos);

      expect(respuesta.status).toBe(500);
      expect(JSON.stringify(respuesta.body)).not.toContain(
        'Detalle privado de MySQL'
      );
    } finally {
      consola.mockRestore();
    }
  });
});
