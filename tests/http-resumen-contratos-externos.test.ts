// tests/http-resumen-contratos-externos.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/services/resumenContratosExternos.service', () => ({
  obtenerResumenContratosExternos: vi.fn(),
  ErrorResumenContratosExternos:
    class ErrorResumenContratosExternos extends Error {
      constructor(
        public readonly estadoHttp: number,
        mensaje: string
      ) {
        super(mensaje);
      }
    },
}));

vi.mock('../src/services/entregasPorResolverContrato.service', () => ({
  obtenerEntregasPorResolverContrato: vi.fn(),
}));

import router from '../src/routes/contratosExternos.routes';

import {
  obtenerResumenContratosExternos,
} from '../src/services/resumenContratosExternos.service';

import {
  obtenerEntregasPorResolverContrato,
} from '../src/services/entregasPorResolverContrato.service';

describe('Seguridad HTTP - resumen de contratos externos', () => {
  const app = express();

  app.use(express.json());
  app.use('/api/contratos-externos', router);

  const token = (id: number, rol_id: number): string => {
    const secreto = process.env.JWT_SECRET;

    if (!secreto || secreto.length < 32) {
      throw new Error('JWT_SECRET de pruebas no configurado.');
    }

    return jwt.sign(
      { id, rol_id },
      secreto,
      { expiresIn: '5m' }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(obtenerResumenContratosExternos).mockResolvedValue([]);
    vi.mocked(obtenerEntregasPorResolverContrato).mockResolvedValue([]);
  });

  it('rechaza solicitudes sin autenticación', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos/resumen-documental');

    expect(respuesta.status).toBe(401);
    expect(obtenerResumenContratosExternos).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes de trabajadores', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos/resumen-documental')
      .set('Authorization', `Bearer ${token(31, 3)}`);

    expect(respuesta.status).toBe(403);
    expect(obtenerResumenContratosExternos).not.toHaveBeenCalled();
  });

  it('rechaza solicitudes de usuarios externos', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos/resumen-documental')
      .set('Authorization', `Bearer ${token(34, 4)}`);

    expect(respuesta.status).toBe(403);
    expect(obtenerResumenContratosExternos).not.toHaveBeenCalled();
  });

  it('consulta utilizando exclusivamente el administrador autenticado', async () => {
    const respuesta = await request(app)
      .get('/api/contratos-externos/resumen-documental')
      .set('Authorization', `Bearer ${token(12, 1)}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual([]);

    expect(obtenerResumenContratosExternos).toHaveBeenCalledWith({
      administradorId: 12,
    });
  });

  it('no revela errores internos del servidor', async () => {
    vi.mocked(obtenerResumenContratosExternos)
      .mockRejectedValueOnce(new Error('Información privada de MySQL'));

    const consola = vi.spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const respuesta = await request(app)
        .get('/api/contratos-externos/resumen-documental')
        .set('Authorization', `Bearer ${token(12, 1)}`);

      expect(respuesta.status).toBe(500);
      expect(JSON.stringify(respuesta.body))
        .not.toContain('Información privada de MySQL');
    } finally {
      consola.mockRestore();
    }
  });

  it('asocia las entregas al contrato correcto y asigna cero cuando corresponde', async () => {
    vi.mocked(obtenerResumenContratosExternos).mockResolvedValueOnce([
      { id: 50, nombre: 'Contrato A' },
      { id: 51, nombre: 'Contrato B' },
      { id: 52, nombre: 'Contrato C' },
    ] as never);

    vi.mocked(obtenerEntregasPorResolverContrato).mockResolvedValueOnce([
      { contrato_id: 51, total: 3 },
      { contrato_id: 50, total: 2 },
      { contrato_id: 999, total: 7 },
    ]);

    const respuesta = await request(app)
      .get('/api/contratos-externos/resumen-documental')
      .set('Authorization', `Bearer ${token(12, 1)}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual([
      { id: 50, nombre: 'Contrato A', entregas_por_resolver: 2 },
      { id: 51, nombre: 'Contrato B', entregas_por_resolver: 3 },
      { id: 52, nombre: 'Contrato C', entregas_por_resolver: 0 },
    ]);

    expect(obtenerEntregasPorResolverContrato).toHaveBeenCalledWith(12);
    expect(respuesta.headers['cache-control']).toBe('no-store');
  });

  it('rechaza resultados con contadores duplicados', async () => {
    vi.mocked(obtenerEntregasPorResolverContrato).mockResolvedValueOnce([
      { contrato_id: 50, total: 2 },
      { contrato_id: 50, total: 3 },
    ]);

    const consola = vi.spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const respuesta = await request(app)
        .get('/api/contratos-externos/resumen-documental')
        .set('Authorization', `Bearer ${token(12, 1)}`);

      expect(respuesta.status).toBe(500);
      expect(JSON.stringify(respuesta.body))
        .not.toContain('contratos duplicados');
    } finally {
      consola.mockRestore();
    }
  });

});
