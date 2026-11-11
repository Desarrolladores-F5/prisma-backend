// tests/http-consulta-acreditaciones-externas.test.ts

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
  () => ({
    revisarAcreditacionDocumentalExterna: vi.fn(),
    ErrorRevisionAcreditacionExterna:
      class ErrorRevisionAcreditacionExterna extends Error {
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
  '../src/services/autorizacionRevisionDocumentalExterna.service',
  () => ({
    ErrorAutorizacionRevisionExterna:
      class ErrorAutorizacionRevisionExterna extends Error {
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
  '../src/services/consultaAcreditacionesExternas.service',
  () => {
    class ErrorConsultaAcreditacionesExternas extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
        this.name = 'ErrorConsultaAcreditacionesExternas';
      }
    }

    return {
      obtenerAcreditacionesExternasContrato: vi.fn(),
      ErrorConsultaAcreditacionesExternas,
    };
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
  obtenerAcreditacionesExternasContrato,
  ErrorConsultaAcreditacionesExternas,
} from '../src/services/consultaAcreditacionesExternas.service';

describe('Seguridad HTTP - consulta de acreditaciones externas', () => {
  const app = express();

  app.use(express.json());
  app.use('/api/contratos-externos', router);

  const ruta = '/api/contratos-externos/15/acreditaciones';

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

  const autorizacion = (
    id = 12,
    rol_id = 1
  ): string => `Bearer ${token(id, rol_id)}`;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(
      obtenerAcreditacionesExternasContrato
    ).mockResolvedValue({
      contratoId: 15,
      tipoAcceso: 'mandante',
      pagina: 1,
      limite: 20,
      total: 1,
      totalPaginas: 1,
      acreditaciones: [
        {
          id: 100,
          contrato_id: 15,
          requisito_id: 30,
          documento_id: 45,
          estado: 'pendiente',
        },
      ],
    } as Awaited<
      ReturnType<typeof obtenerAcreditacionesExternasContrato>
    >);
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app).get(ruta);

    expect(respuesta.status).toBe(401);

    expect(
      obtenerAcreditacionesExternasContrato
    ).not.toHaveBeenCalled();
  });

  it.each([
    'abc',
    '0',
    '-1',
    '1.5',
    '999999999999999999999',
  ])('rechaza identificador de contrato inválido: %s', async id => {
    const respuesta = await request(app)
      .get(`/api/contratos-externos/${id}/acreditaciones`)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(400);

    expect(
      obtenerAcreditacionesExternasContrato
    ).not.toHaveBeenCalled();
  });

  it.each([
    '?pagina=0',
    '?pagina=-1',
    '?pagina=abc',
    '?pagina=1.5',
    '?limite=0',
    '?limite=-1',
    '?limite=abc',
    '?limite=101',
    '?limite=1.5',
    '?pagina=999999999999999999999',
    '?pagina=9007199254740991&limite=100',
  ])('rechaza paginación inválida: %s', async parametros => {
    const respuesta = await request(app)
      .get(`${ruta}${parametros}`)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(400);

    expect(
      obtenerAcreditacionesExternasContrato
    ).not.toHaveBeenCalled();
  });

  it.each([
    '?empresaId=3',
    '?empresa_id=3',
    '?usuarioId=999',
    '?administradorId=999',
    '?contratoId=999',
    '?transaction=1',
  ])('rechaza parámetros no permitidos: %s', async parametros => {
    const respuesta = await request(app)
      .get(`${ruta}${parametros}`)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(400);

    expect(
      obtenerAcreditacionesExternasContrato
    ).not.toHaveBeenCalled();
  });

  it('rechaza parámetros repetidos', async () => {
    const respuesta = await request(app)
      .get(`${ruta}?pagina=1&pagina=2`)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(400);

    expect(
      obtenerAcreditacionesExternasContrato
    ).not.toHaveBeenCalled();
  });

  it('obtiene el usuario exclusivamente del JWT', async () => {
    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', autorizacion(12, 1));

    expect(respuesta.status).toBe(200);

    expect(
      obtenerAcreditacionesExternasContrato
    ).toHaveBeenCalledWith({
      usuarioId: 12,
      contratoId: 15,
      pagina: 1,
      limite: 20,
    });

    expect(respuesta.body.acreditaciones).toHaveLength(1);
  });

  it('admite una identidad de administrador externo', async () => {
    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', autorizacion(31, 3));

    expect(respuesta.status).toBe(200);

    expect(
      obtenerAcreditacionesExternasContrato
    ).toHaveBeenCalledWith({
      usuarioId: 31,
      contratoId: 15,
      pagina: 1,
      limite: 20,
    });
  });

  it('transmite correctamente la paginación solicitada', async () => {
    const respuesta = await request(app)
      .get(`${ruta}?pagina=3&limite=10`)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(200);

    expect(
      obtenerAcreditacionesExternasContrato
    ).toHaveBeenCalledWith({
      usuarioId: 12,
      contratoId: 15,
      pagina: 3,
      limite: 10,
    });
  });

  it('admite el límite máximo de 100 registros', async () => {
    const respuesta = await request(app)
      .get(`${ruta}?pagina=1&limite=100`)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(200);

    expect(
      obtenerAcreditacionesExternasContrato
    ).toHaveBeenCalledWith({
      usuarioId: 12,
      contratoId: 15,
      pagina: 1,
      limite: 100,
    });
  });

  it('respeta el rechazo de acceso entre empresas', async () => {
    vi.mocked(
      obtenerAcreditacionesExternasContrato
    ).mockRejectedValueOnce(
      new ErrorConsultaAcreditacionesExternas(
        403,
        'No tiene autorización para consultar este contrato.'
      )
    );

    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(403);
  });

  it('respeta errores de contrato inexistente', async () => {
    vi.mocked(
      obtenerAcreditacionesExternasContrato
    ).mockRejectedValueOnce(
      new ErrorConsultaAcreditacionesExternas(
        404,
        'Contrato externo no encontrado.'
      )
    );

    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(404);
  });

  it('rechaza consultas de empresas inactivas', async () => {
    vi.mocked(
      obtenerAcreditacionesExternasContrato
    ).mockRejectedValueOnce(
      new ErrorConsultaAcreditacionesExternas(
        403,
        'La empresa no está habilitada.'
      )
    );

    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', autorizacion());

    expect(respuesta.status).toBe(403);
  });

  it('no expone detalles internos de MySQL', async () => {
    vi.mocked(
      obtenerAcreditacionesExternasContrato
    ).mockRejectedValueOnce(
      new Error('Detalle privado de MySQL')
    );

    const consola = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const respuesta = await request(app)
        .get(ruta)
        .set('Authorization', autorizacion());

      expect(respuesta.status).toBe(500);

      expect(JSON.stringify(respuesta.body)).not.toContain(
        'Detalle privado de MySQL'
      );
    } finally {
      consola.mockRestore();
    }
  });
});
