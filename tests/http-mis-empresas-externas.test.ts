// tests/http-mis-empresas-externas.test.ts

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/services/misEmpresasExternas.service', () => {
  class ErrorConsultaMisEmpresasExternas extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorConsultaMisEmpresasExternas';
    }
  }

  return {
    obtenerMisEmpresasExternas: vi.fn(),
    ErrorConsultaMisEmpresasExternas,
  };
});

import {
  obtenerMisEmpresasExternas,
  ErrorConsultaMisEmpresasExternas,
} from '../src/services/misEmpresasExternas.service';

import empresasExternasRoutes from '../src/routes/empresasExternas.routes';

const app = express();

app.use(express.json());

app.use(
  '/api/empresas-externas',
  empresasExternasRoutes
);

const ruta = '/api/empresas-externas/mis-empresas';

const obtenerSecreto = (): string => {
  const secreto = process.env.JWT_SECRET;

  if (!secreto || secreto.length < 32) {
    throw new Error(
      'JWT_SECRET de pruebas inválido.'
    );
  }

  return secreto;
};

const crearToken = (
  id: number,
  rol_id: number
): string =>
  jwt.sign(
    { id, rol_id },
    obtenerSecreto(),
    { expiresIn: '5m' }
  );

describe('HTTP - Mis Empresas Externas', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(
      obtenerMisEmpresasExternas
    ).mockResolvedValue({
      empresas: [
        {
          empresaId: 3,
          nombre: 'Empresa Contratista',
          perfil: 'administrador_externo',
        },
      ],
    });
  });

  it('rechaza solicitudes sin JWT', async () => {
    const respuesta = await request(app).get(ruta);

    expect(respuesta.status).toBe(401);
    expect(
      obtenerMisEmpresasExternas
    ).not.toHaveBeenCalled();
  });

  it('rechaza JWT inválidos', async () => {
    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', 'Bearer token-invalido');

    expect(respuesta.status).toBe(401);
    expect(
      obtenerMisEmpresasExternas
    ).not.toHaveBeenCalled();
  });

  it('rechaza JWT expirados', async () => {
    const token = jwt.sign(
      {
        id: 10,
        rol_id: 3,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      obtenerSecreto()
    );

    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(401);
    expect(
      obtenerMisEmpresasExternas
    ).not.toHaveBeenCalled();
  });

  it('rechaza tokens sin identidad válida', async () => {
    const token = jwt.sign(
      { id: '10', rol_id: 3 },
      obtenerSecreto()
    );

    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(401);
    expect(
      obtenerMisEmpresasExternas
    ).not.toHaveBeenCalled();
  });

  it('consulta las empresas del usuario autenticado', async () => {
    const token = crearToken(10, 3);

    const respuesta = await request(app)
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);

    expect(respuesta.body).toEqual({
      empresas: [
        {
          empresaId: 3,
          nombre: 'Empresa Contratista',
          perfil: 'administrador_externo',
        },
      ],
    });

    expect(
      obtenerMisEmpresasExternas
    ).toHaveBeenCalledExactlyOnceWith(10);
  });

  it('permite consultar con distintos roles generales', async () => {
    for (const rol of [1, 2, 3]) {
      vi.mocked(
        obtenerMisEmpresasExternas
      ).mockClear();

      const respuesta = await request(app)
        .get(ruta)
        .set(
          'Authorization',
          `Bearer ${crearToken(10, rol)}`
        );

      expect(respuesta.status).toBe(200);

      expect(
        obtenerMisEmpresasExternas
      ).toHaveBeenCalledExactlyOnceWith(10);
    }
  });

  it('rechaza parámetros de otros usuarios', async () => {
    const respuesta = await request(app)
      .get(`${ruta}?usuarioId=999`)
      .set(
        'Authorization',
        `Bearer ${crearToken(10, 3)}`
      );

    expect(respuesta.status).toBe(400);

    expect(
      obtenerMisEmpresasExternas
    ).not.toHaveBeenCalled();
  });

  it('rechaza identificadores empresariales enviados como consulta', async () => {
    const respuesta = await request(app)
      .get(`${ruta}?empresaId=99`)
      .set(
        'Authorization',
        `Bearer ${crearToken(10, 3)}`
      );

    expect(respuesta.status).toBe(400);

    expect(
      obtenerMisEmpresasExternas
    ).not.toHaveBeenCalled();
  });

  it('rechaza cuerpos JSON no permitidos', async () => {
    const respuesta = await request(app)
      .get(ruta)
      .set(
        'Authorization',
        `Bearer ${crearToken(10, 3)}`
      )
      .send({ usuarioId: 999 });

    expect(respuesta.status).toBe(400);

    expect(
      obtenerMisEmpresasExternas
    ).not.toHaveBeenCalled();
  });

  it('propaga errores de autorización del servicio', async () => {
    vi.mocked(
      obtenerMisEmpresasExternas
    ).mockRejectedValue(
      new ErrorConsultaMisEmpresasExternas(
        403,
        'Usuario sin autorización vigente.'
      )
    );

    const respuesta = await request(app)
      .get(ruta)
      .set(
        'Authorization',
        `Bearer ${crearToken(10, 3)}`
      );

    expect(respuesta.status).toBe(403);

    expect(respuesta.body).toEqual({
      mensaje: 'Usuario sin autorización vigente.',
    });
  });

  it('devuelve una lista vacía cuando no hay empresas vinculadas', async () => {
    vi.mocked(
      obtenerMisEmpresasExternas
    ).mockResolvedValue({ empresas: [] });

    const respuesta = await request(app)
      .get(ruta)
      .set(
        'Authorization',
        `Bearer ${crearToken(10, 3)}`
      );

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({
      empresas: [],
    });
  });

  it('no revela detalles internos ante errores inesperados', async () => {
    vi.mocked(
      obtenerMisEmpresasExternas
    ).mockRejectedValue(
      new Error('Fallo interno de conexión MySQL')
    );

    const consola = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      const respuesta = await request(app)
        .get(ruta)
        .set(
          'Authorization',
          `Bearer ${crearToken(10, 3)}`
        );

      expect(respuesta.status).toBe(500);

      expect(respuesta.body).toEqual({
        mensaje:
          'No fue posible consultar las empresas externas.',
      });

      expect(
        JSON.stringify(respuesta.body)
      ).not.toContain('MySQL');
    } finally {
      consola.mockRestore();
    }
  });
});
