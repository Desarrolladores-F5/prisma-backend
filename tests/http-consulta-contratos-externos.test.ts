// tests/http-consulta-contratos-externos.test.ts

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

vi.mock('../src/services/consultaContratosExternos.service', () => {
  class ErrorConsultaContratosExternos extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorConsultaContratosExternos';
    }
  }

  return {
    obtenerContratosExternosMandante: vi.fn(),
    ErrorConsultaContratosExternos,
  };
});

vi.mock('../src/services/asignacionDocumental.service', () => ({
  ErrorAsignacionDocumental: class ErrorAsignacionDocumental extends Error {
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
  obtenerContratosExternosMandante,
  ErrorConsultaContratosExternos,
} from '../src/services/consultaContratosExternos.service';

describe('Seguridad HTTP - consulta de contratos externos', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/contratos-externos', router);

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
    vi.mocked(obtenerContratosExternosMandante).mockResolvedValue([]);
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos');

    expect(respuesta.status).toBe(401);
    expect(obtenerContratosExternosMandante).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes de trabajadores', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(31, 3)}`);

    expect(respuesta.status).toBe(403);
    expect(obtenerContratosExternosMandante).not.toHaveBeenCalled();
  });

  it('consulta usando exclusivamente el administrador del JWT', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(12, 1)}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual([]);

    expect(obtenerContratosExternosMandante).toHaveBeenCalledWith({
      administradorId: 12,
    });
  });

  it('devuelve los contratos autorizados', async () => {
    vi.mocked(obtenerContratosExternosMandante).mockResolvedValueOnce([
      {
        id: 50,
        nombre: 'Contrato autorizado',
        mandante_empresa_id: 1,
      },
    ] as Awaited<ReturnType<typeof obtenerContratosExternosMandante>>);

    const respuesta = await request(app)
      .get('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(12, 1)}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toHaveLength(1);
    expect(respuesta.body[0].id).toBe(50);
  });

  it('respeta errores de autorización empresarial', async () => {
    vi.mocked(obtenerContratosExternosMandante).mockRejectedValueOnce(
      new ErrorConsultaContratosExternos(
        403,
        'Administrador sin autorización.'
      )
    );

    const respuesta = await request(app)
      .get('/api/contratos-externos')
      .set('Authorization', `Bearer ${token(12, 1)}`);

    expect(respuesta.status).toBe(403);
  });

  it('no expone detalles internos de MySQL', async () => {
    vi.mocked(obtenerContratosExternosMandante).mockRejectedValueOnce(
      new Error('Detalle privado de MySQL')
    );

    const consola = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const respuesta = await request(app)
        .get('/api/contratos-externos')
        .set('Authorization', `Bearer ${token(12, 1)}`);

      expect(respuesta.status).toBe(500);
      expect(JSON.stringify(respuesta.body)).not.toContain(
        'Detalle privado de MySQL'
      );
    } finally {
      consola.mockRestore();
    }
  });
});
