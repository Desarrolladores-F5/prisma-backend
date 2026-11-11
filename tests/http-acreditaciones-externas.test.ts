// tests/http-acreditaciones-externas.test.ts

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

vi.mock('../src/services/trabajadoresContratosExternos.service', () => ({
  vincularTrabajadorContratoExterno: vi.fn(),
  ErrorTrabajadorContratoExterno:
    class ErrorTrabajadorContratoExterno extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
      }
    },
}));

vi.mock(
  '../src/services/registroAcreditacionDocumentalExterna.service',
  () => {
    class ErrorRegistroAcreditacionExterna extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
        this.name = 'ErrorRegistroAcreditacionExterna';
      }
    }

    return {
      registrarAcreditacionDocumentalExterna: vi.fn(),
      ErrorRegistroAcreditacionExterna,
    };
  }
);

vi.mock(
  '../src/services/autorizacionPresentacionDocumentalExterna.service',
  () => {
    class ErrorPresentacionDocumentalExterna extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
        this.name = 'ErrorPresentacionDocumentalExterna';
      }
    }

    return { ErrorPresentacionDocumentalExterna };
  }
);

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
  registrarAcreditacionDocumentalExterna,
  ErrorRegistroAcreditacionExterna,
} from '../src/services/registroAcreditacionDocumentalExterna.service';

import {
  ErrorPresentacionDocumentalExterna,
} from '../src/services/autorizacionPresentacionDocumentalExterna.service';

import {
  ErrorAutorizacionEmpresaExterna,
} from '../src/services/autorizacionEmpresasExternas.service';

describe('Seguridad HTTP - acreditaciones documentales externas', () => {
  const app = express();

  app.use(express.json());
  app.use('/api/contratos-externos', router);

  const ruta = '/api/contratos-externos/15/acreditaciones';

  const datosValidos = {
    requisitoId: 30,
    documentoId: 45,
    contratoTrabajadorId: 80,
    fechaEmision: '2026-11-10',
    fechaVencimiento: '2027-11-10',
    periodoInicio: '2026-11-01',
    periodoTermino: '2026-11-30',
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

  const autenticacion = (): string =>
    `Bearer ${token(12, 3)}`;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(
      registrarAcreditacionDocumentalExterna
    ).mockResolvedValue({
      id: 100,
      contrato_id: 15,
      requisito_id: 30,
      documento_id: 45,
      contrato_trabajador_id: 80,
      estado: 'pendiente',
      presentado_por: 12,
    } as Awaited<
      ReturnType<typeof registrarAcreditacionDocumentalExterna>
    >);
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .send(datosValidos);

    expect(respuesta.status).toBe(401);

    expect(
      registrarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de contrato inválidos', async () => {
    const respuesta = await request(app)
      .post('/api/contratos-externos/abc/acreditaciones')
      .set('Authorization', autenticacion())
      .send(datosValidos);

    expect(respuesta.status).toBe(400);

    expect(
      registrarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('rechaza identificadores documentales inválidos', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send({
        requisitoId: -1,
        documentoId: 45,
      });

    expect(respuesta.status).toBe(400);

    expect(
      registrarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de trabajador inválidos', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send({
        ...datosValidos,
        contratoTrabajadorId: '80',
      });

    expect(respuesta.status).toBe(400);

    expect(
      registrarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('rechaza falsificación de identidad del presentador', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send({
        ...datosValidos,
        administradorId: 999,
      });

    expect(respuesta.status).toBe(400);

    expect(
      registrarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it.each([
    'estado',
    'presentado_por',
    'revisado_por',
    'transaction',
    'empresa_id',
  ])(
    'rechaza el campo protegido %s',
    async campo => {
      const respuesta = await request(app)
        .post(ruta)
        .set('Authorization', autenticacion())
        .send({
          ...datosValidos,
          [campo]: 999,
        });

      expect(respuesta.status).toBe(400);

      expect(
        registrarAcreditacionDocumentalExterna
      ).not.toHaveBeenCalled();
    }
  );

  it('rechaza fechas con tipos incorrectos', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send({
        ...datosValidos,
        fechaEmision: 123456,
      });

    expect(respuesta.status).toBe(400);

    expect(
      registrarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('obtiene el administrador exclusivamente del JWT', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send(datosValidos);

    expect(respuesta.status).toBe(201);

    expect(
      registrarAcreditacionDocumentalExterna
    ).toHaveBeenCalledWith({
      administradorId: 12,
      contratoId: 15,
      requisitoId: 30,
      documentoId: 45,
      contratoTrabajadorId: 80,
      fechaEmision: '2026-11-10',
      fechaVencimiento: '2027-11-10',
      periodoInicio: '2026-11-01',
      periodoTermino: '2026-11-30',
    });

    expect(respuesta.body.acreditacion.estado).toBe(
      'pendiente'
    );
  });

  it('permite omitir trabajador y fechas opcionales', async () => {
    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send({
        requisitoId: 30,
        documentoId: 45,
      });

    expect(respuesta.status).toBe(201);

    expect(
      registrarAcreditacionDocumentalExterna
    ).toHaveBeenCalledWith({
      administradorId: 12,
      contratoId: 15,
      requisitoId: 30,
      documentoId: 45,
      contratoTrabajadorId: undefined,
      fechaEmision: undefined,
      fechaVencimiento: undefined,
      periodoInicio: undefined,
      periodoTermino: undefined,
    });
  });

  it('respeta errores de autorización multiempresa', async () => {
    vi.mocked(
      registrarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new ErrorAutorizacionEmpresaExterna(
        403,
        'Administrador externo sin autorización.'
      )
    );

    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send(datosValidos);

    expect(respuesta.status).toBe(403);
  });

  it('respeta errores de autorización documental', async () => {
    vi.mocked(
      registrarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new ErrorPresentacionDocumentalExterna(
        403,
        'El documento pertenece a otra empresa.'
      )
    );

    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send(datosValidos);

    expect(respuesta.status).toBe(403);
  });

  it('respeta errores de validación de fechas', async () => {
    vi.mocked(
      registrarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new ErrorRegistroAcreditacionExterna(
        400,
        'Fecha documental inválida.'
      )
    );

    const respuesta = await request(app)
      .post(ruta)
      .set('Authorization', autenticacion())
      .send(datosValidos);

    expect(respuesta.status).toBe(400);
  });

  it('no expone errores internos de MySQL', async () => {
    vi.mocked(
      registrarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new Error('Detalle privado de MySQL')
    );

    const consola = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const respuesta = await request(app)
        .post(ruta)
        .set('Authorization', autenticacion())
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
