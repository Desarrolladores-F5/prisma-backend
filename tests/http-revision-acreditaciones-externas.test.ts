// tests/http-revision-acreditaciones-externas.test.ts

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
  () => ({
    registrarAcreditacionDocumentalExterna: vi.fn(),
    ErrorRegistroAcreditacionExterna:
      class ErrorRegistroAcreditacionExterna extends Error {
        constructor(
          public readonly estadoHttp: number,
          mensaje: string
        ) {
          super(mensaje);
        }
      },
  })
);

vi.mock(
  '../src/services/autorizacionPresentacionDocumentalExterna.service',
  () => ({
    ErrorPresentacionDocumentalExterna:
      class ErrorPresentacionDocumentalExterna extends Error {
        constructor(
          public readonly estadoHttp: number,
          mensaje: string
        ) {
          super(mensaje);
        }
      },
  })
);

vi.mock('../src/services/autorizacionEmpresasExternas.service', () => ({
  ErrorAutorizacionEmpresaExterna:
    class ErrorAutorizacionEmpresaExterna extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
      }
    },
}));

vi.mock(
  '../src/services/revisionAcreditacionDocumentalExterna.service',
  () => {
    class ErrorRevisionAcreditacionExterna extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
        this.name = 'ErrorRevisionAcreditacionExterna';
      }
    }

    return {
      revisarAcreditacionDocumentalExterna: vi.fn(),
      ErrorRevisionAcreditacionExterna,
    };
  }
);

vi.mock(
  '../src/services/autorizacionRevisionDocumentalExterna.service',
  () => {
    class ErrorAutorizacionRevisionExterna extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
        this.name = 'ErrorAutorizacionRevisionExterna';
      }
    }

    return { ErrorAutorizacionRevisionExterna };
  }
);

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
  revisarAcreditacionDocumentalExterna,
  ErrorRevisionAcreditacionExterna,
} from '../src/services/revisionAcreditacionDocumentalExterna.service';

import {
  ErrorAutorizacionRevisionExterna,
} from '../src/services/autorizacionRevisionDocumentalExterna.service';

import {
  ErrorAsignacionDocumental,
} from '../src/services/asignacionDocumental.service';

describe('Seguridad HTTP - revisión de acreditaciones externas', () => {
  const app = express();

  app.use(express.json());
  app.use('/api/contratos-externos', router);

  const ruta =
    '/api/contratos-externos/acreditaciones/100/revision';

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

  const autorizacion = (): string =>
    `Bearer ${token(12, 1)}`;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(
      revisarAcreditacionDocumentalExterna
    ).mockResolvedValue({
      acreditacionId: 100,
      contratoId: 15,
      estado: 'en_revision',
      revisadoPor: 12,
    });
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .send({ accion: 'iniciar_revision' });

    expect(respuesta.status).toBe(401);
    expect(
      revisarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it.each([
    'abc',
    '0',
    '-1',
    '1.5',
    '999999999999999999999',
  ])('rechaza ID de acreditación inválido: %s', async id => {
    const respuesta = await request(app)
      .patch(
        `/api/contratos-externos/acreditaciones/${id}/revision`
      )
      .set('Authorization', autorizacion())
      .send({ accion: 'iniciar_revision' });

    expect(respuesta.status).toBe(400);
    expect(
      revisarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('rechaza acciones desconocidas', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({ accion: 'modificar_estado' });

    expect(respuesta.status).toBe(400);
    expect(
      revisarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it.each([
    'administradorId',
    'empresaId',
    'contratoId',
    'estado',
    'revisado_por',
    'fecha_revision',
    'transaction',
  ])('rechaza el campo protegido %s', async campo => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({
        accion: 'aprobar',
        [campo]: 999,
      });

    expect(respuesta.status).toBe(400);
    expect(
      revisarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('rechaza observaciones que no son texto', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({
        accion: 'aprobar',
        observaciones: 123,
      });

    expect(respuesta.status).toBe(400);
    expect(
      revisarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('rechaza observaciones superiores a 2000 caracteres', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({
        accion: 'aprobar',
        observaciones: 'A'.repeat(2001),
      });

    expect(respuesta.status).toBe(400);
    expect(
      revisarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('exige observaciones al rechazar', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({
        accion: 'rechazar',
        observaciones: '   ',
      });

    expect(respuesta.status).toBe(400);
    expect(
      revisarAcreditacionDocumentalExterna
    ).not.toHaveBeenCalled();
  });

  it('permite iniciar una revisión con identidad JWT', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({ accion: 'iniciar_revision' });

    expect(respuesta.status).toBe(200);

    expect(
      revisarAcreditacionDocumentalExterna
    ).toHaveBeenCalledWith({
      administradorId: 12,
      acreditacionId: 100,
      accion: 'iniciar_revision',
      observaciones: undefined,
    });
  });

  it('permite aprobar una acreditación', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({
        accion: 'aprobar',
        observaciones: 'Documentación conforme.',
      });

    expect(respuesta.status).toBe(200);

    expect(
      revisarAcreditacionDocumentalExterna
    ).toHaveBeenCalledWith({
      administradorId: 12,
      acreditacionId: 100,
      accion: 'aprobar',
      observaciones: 'Documentación conforme.',
    });
  });

  it('permite rechazar con observaciones', async () => {
    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({
        accion: 'rechazar',
        observaciones: 'Documento vencido.',
      });

    expect(respuesta.status).toBe(200);

    expect(
      revisarAcreditacionDocumentalExterna
    ).toHaveBeenCalledWith({
      administradorId: 12,
      acreditacionId: 100,
      accion: 'rechazar',
      observaciones: 'Documento vencido.',
    });
  });

  it('respeta la prohibición de revisar otra empresa', async () => {
    vi.mocked(
      revisarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new ErrorAutorizacionRevisionExterna(
        403,
        'No tiene autorización para revisar esta acreditación.'
      )
    );

    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({ accion: 'aprobar' });

    expect(respuesta.status).toBe(403);
  });

  it('respeta conflictos de revisión concurrente', async () => {
    vi.mocked(
      revisarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new ErrorRevisionAcreditacionExterna(
        409,
        'La acreditación fue modificada por otra solicitud.'
      )
    );

    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({ accion: 'aprobar' });

    expect(respuesta.status).toBe(409);
  });

  it('respeta errores de autorización del administrador', async () => {
    vi.mocked(
      revisarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new ErrorAsignacionDocumental(
        403,
        'El usuario no es administrador de la mandante.'
      )
    );

    const respuesta = await request(app)
      .patch(ruta)
      .set('Authorization', autorizacion())
      .send({ accion: 'iniciar_revision' });

    expect(respuesta.status).toBe(403);
  });

  it('no expone detalles internos de MySQL', async () => {
    vi.mocked(
      revisarAcreditacionDocumentalExterna
    ).mockRejectedValueOnce(
      new Error('Detalle privado de MySQL')
    );

    const consola = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const respuesta = await request(app)
        .patch(ruta)
        .set('Authorization', autorizacion())
        .send({ accion: 'aprobar' });

      expect(respuesta.status).toBe(500);

      expect(JSON.stringify(respuesta.body)).not.toContain(
        'Detalle privado de MySQL'
      );
    } finally {
      consola.mockRestore();
    }
  });
});
