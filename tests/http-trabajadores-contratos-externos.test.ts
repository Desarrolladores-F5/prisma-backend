// tests/http-trabajadores-contratos-externos.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/services/contratosExternos.service', () => ({
  crearContratoExterno: vi.fn(),
  ErrorContratoExterno: class ErrorContratoExterno extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
    }
  },
}));

vi.mock('../src/services/consultaContratosExternos.service', () => ({
  obtenerContratosExternosMandante: vi.fn(),
  ErrorConsultaContratosExternos:
    class ErrorConsultaContratosExternos extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
      }
    },
}));

vi.mock('../src/services/trabajadoresContratosExternos.service', () => {
  class ErrorTrabajadorContratoExterno extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorTrabajadorContratoExterno';
    }
  }

  return {
    vincularTrabajadorContratoExterno: vi.fn(),
    ErrorTrabajadorContratoExterno,
  };
});

vi.mock('../src/services/autorizacionEmpresasExternas.service', () => {
  class ErrorAutorizacionEmpresaExterna extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorAutorizacionEmpresaExterna';
    }
  }

  return { ErrorAutorizacionEmpresaExterna };
});

vi.mock('../src/services/asignacionDocumental.service', () => ({
  ErrorAsignacionDocumental:
    class ErrorAsignacionDocumental extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
      }
    },
}));

import router from '../src/routes/contratosExternos.routes';

import {
  vincularTrabajadorContratoExterno,
  ErrorTrabajadorContratoExterno,
} from '../src/services/trabajadoresContratosExternos.service';

import {
  ErrorAutorizacionEmpresaExterna,
} from '../src/services/autorizacionEmpresasExternas.service';

describe('Seguridad HTTP - trabajadores de contratos externos', () => {
  const app = express();

  app.use(express.json());
  app.use('/api/contratos-externos', router);

  const ruta = '/api/contratos-externos/15/trabajadores';

  const datosValidos = {
    trabajadorId: 25,
    fechaIncorporacion: '2026-11-10',
  };

  const token = (id: number, rol_id: number): string => {
    const secreto = process.env.JWT_SECRET;

    if (!secreto || secreto.length < 32) {
      throw new Error('JWT_SECRET de pruebas inválido.');
    }

    return jwt.sign(
      { id, rol_id },
      secreto,
      { expiresIn: '5m' }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(
      vincularTrabajadorContratoExterno
    ).mockResolvedValue({
      id: 80,
      contrato_id: 15,
      usuario_id: 25,
      activo: true,
    } as Awaited<
      ReturnType<typeof vincularTrabajadorContratoExterno>
    >);
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .send(datosValidos);

    expect(respuesta.status).toBe(401);

    expect(
      vincularTrabajadorContratoExterno
    ).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de contrato inválidos', async () => {
    const respuesta = await request(app)
      .post('/api/contratos-externos/abc/trabajadores')
      .set('Authorization', `Bearer ${token(12, 3)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(400);

    expect(
      vincularTrabajadorContratoExterno
    ).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de trabajador inválidos', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', `Bearer ${token(12, 3)}`)
      .send({ trabajadorId: -1 });

    expect(respuesta.status).toBe(400);

    expect(
      vincularTrabajadorContratoExterno
    ).not.toHaveBeenCalled();
  });

  it('rechaza campos empresariales no autorizados', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', `Bearer ${token(12, 3)}`)
      .send({
        ...datosValidos,
        empresa_id: 999,
      });

    expect(respuesta.status).toBe(400);

    expect(
      vincularTrabajadorContratoExterno
    ).not.toHaveBeenCalled();
  });

  it('rechaza fechas con tipos incorrectos', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', `Bearer ${token(12, 3)}`)
      .send({
        ...datosValidos,
        fechaIncorporacion: 123456,
      });

    expect(respuesta.status).toBe(400);

    expect(
      vincularTrabajadorContratoExterno
    ).not.toHaveBeenCalled();
  });

  it('obtiene el administrador exclusivamente del JWT', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', `Bearer ${token(12, 3)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(201);

    expect(
      vincularTrabajadorContratoExterno
    ).toHaveBeenCalledWith({
      administradorId: 12,
      contratoId: 15,
      trabajadorId: 25,
      fechaIncorporacion: '2026-11-10',
      fechaDesvinculacion: undefined,
    });
  });

  it('respeta errores de autorización multiempresa', async () => {
    vi.mocked(
      vincularTrabajadorContratoExterno
    ).mockRejectedValueOnce(
      new ErrorAutorizacionEmpresaExterna(
        403,
        'Administrador externo sin autorización.'
      )
    );

    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', `Bearer ${token(12, 3)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(403);
  });

  it('respeta errores de vinculación duplicada', async () => {
    vi.mocked(
      vincularTrabajadorContratoExterno
    ).mockRejectedValueOnce(
      new ErrorTrabajadorContratoExterno(
        409,
        'El trabajador ya está vinculado.'
      )
    );

    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', `Bearer ${token(12, 3)}`)
      .send(datosValidos);

    expect(respuesta.status).toBe(409);
  });

  it('no expone errores internos de MySQL', async () => {
    vi.mocked(
      vincularTrabajadorContratoExterno
    ).mockRejectedValueOnce(
      new Error('Detalle privado de MySQL')
    );

    const consola = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const respuesta = await request(app)
        .post(ruta)
        .set('Authorization', `Bearer ${token(12, 3)}`)
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
