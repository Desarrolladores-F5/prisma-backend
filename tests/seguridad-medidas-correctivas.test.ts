import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/models', () => ({
  MedidaCorrectiva: {
    findAll: vi.fn(),
    findByPk: vi.fn(),
    create: vi.fn(),
  },
  Usuario: { findByPk: vi.fn() },
  Faena: {
    findAll: vi.fn(),
    findByPk: vi.fn(),
  },
  Documento: { findByPk: vi.fn() },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
}));

vi.mock('../src/services/notificacionesAutomaticas.service', () => ({
  avisarMedidaCorrectiva: vi.fn(),
}));

vi.mock('../src/utils/registrarHistorial', () => ({
  registrarHistorial: vi.fn(),
}));

import router from '../src/routes/medida_correctiva.routes';
import { MedidaCorrectiva } from '../src/models';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { Usuario, Faena } from '../src/models';
import { obtenerEmpresaAdministrador } from '../src/services/asignacionDocumental.service';


describe('Seguridad HTTP de medidas correctivas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const app = express();

  app.use(express.json());
  app.use('/medidas', router);

  it('rechaza consultas sin autenticación', async () => {
    const respuesta = await request(app).get('/medidas');

    expect(respuesta.status).toBe(401);
    expect(MedidaCorrectiva.findAll).not.toHaveBeenCalled();
  });
  it('filtra las medidas del administrador por faenas de su empresa', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 2,
      rol_id: 1,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(Faena.findAll).mockResolvedValueOnce([
      { get: () => 1 },
      { get: () => 3 },
    ] as any);

    vi.mocked(MedidaCorrectiva.findAll).mockResolvedValueOnce([] as any);

    const token = jwt.sign(
      { id: 2, rol_id: 1 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .get('/medidas')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);
    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(2);

    expect(Faena.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresa_id: 1 },
      })
    );

    const opciones = vi.mocked(MedidaCorrectiva.findAll)
      .mock.calls[0][0] as any;

    expect(opciones.where.faena_id[Op.in]).toEqual([1, 3]);
  });

  it('limita al supervisor a su faena autorizada', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 9,
      rol_id: 2,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce({
      id: 3,
      get: (campo: string) => ({
        activo: true,
        empresa_id: 1,
      } as Record<string, unknown>)[campo],
    } as any);

    vi.mocked(MedidaCorrectiva.findAll)
      .mockResolvedValueOnce([] as any);

    const token = jwt.sign(
      { id: 9, rol_id: 2 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .get('/medidas')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);

    const opciones = vi.mocked(MedidaCorrectiva.findAll)
      .mock.calls.at(-1)?.[0] as any;

    expect(opciones.where.faena_id[Op.in]).toEqual([3]);
    expect(obtenerEmpresaAdministrador).not.toHaveBeenCalled();
  });

  it('rechaza crear una medida en otra empresa', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 2,
      rol_id: 1,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce({
      id: 8,
      get: (campo: string) => ({
        empresa_id: 2,
        activo: true,
      } as Record<string, unknown>)[campo],
    } as any);

    const token = jwt.sign(
      { id: 2, rol_id: 1 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .post('/medidas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        descripcion: 'Medida de otra empresa',
        fecha_cumplimiento: '2026-12-15',
        estado: 'pendiente',
        prioridad: 'alta',
        faena_id: 8,
        responsable_id: 31,
      });

    expect(respuesta.status).toBe(403);
    expect(MedidaCorrectiva.create).not.toHaveBeenCalled();
    expect(Usuario.findByPk).toHaveBeenCalledTimes(1);
  });

  it('rechaza asignar un responsable de otra faena', async () => {
    vi.mocked(Usuario.findByPk)
      .mockResolvedValueOnce({
        id: 2,
        rol_id: 1,
        activo: true,
        faena_id: 3,
      } as any)
      .mockResolvedValueOnce({
        id: 31,
        activo: true,
        faena_id: 8,
      } as any);

    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValueOnce(1);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce({
      id: 3,
      get: (campo: string) => ({
        empresa_id: 1,
        activo: true,
      } as Record<string, unknown>)[campo],
    } as any);

    const token = jwt.sign(
      { id: 2, rol_id: 1 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .post('/medidas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        descripcion: 'Verificar elementos de seguridad',
        fecha_cumplimiento: '2026-12-15',
        estado: 'pendiente',
        prioridad: 'alta',
        faena_id: 3,
        responsable_id: 31,
      });

    expect(respuesta.status).toBe(400);
    expect(MedidaCorrectiva.create).not.toHaveBeenCalled();
  });

  it('rechaza evidencia documental de otra empresa', async () => {
    vi.mocked(Usuario.findByPk)
      .mockResolvedValueOnce({
        id: 2,
        rol_id: 1,
        activo: true,
        faena_id: 3,
      } as any)
      .mockResolvedValueOnce({
        id: 23,
        activo: true,
        faena_id: 3,
      } as any);

    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValueOnce(1);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce({
      id: 3,
      get: (campo: string) => ({
        empresa_id: 1,
        activo: true,
      } as Record<string, unknown>)[campo],
    } as any);

    const { Documento } = await import('../src/models');

    vi.mocked(Documento.findByPk).mockResolvedValueOnce({
      id: 20,
      empresa_id: 2,
    } as any);

    const token = jwt.sign(
      { id: 2, rol_id: 1 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .post('/medidas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        descripcion: 'Revisar condiciones de seguridad',
        fecha_cumplimiento: '2026-12-15',
        estado: 'pendiente',
        prioridad: 'alta',
        faena_id: 3,
        responsable_id: 23,
        evidencia_documento_id: 20,
      });

    expect(respuesta.status).toBe(403);
    expect(Documento.findByPk).toHaveBeenCalledWith(20);
    expect(MedidaCorrectiva.create).not.toHaveBeenCalled();
  });

  it('impide modificar una medida histórica sin faena', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 2,
      rol_id: 1,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValueOnce(1);

    const actualizar = vi.fn();

    vi.mocked(MedidaCorrectiva.findByPk)
      .mockResolvedValueOnce({
        id: 4,
        faena_id: null,
        responsable_id: 23,
        update: actualizar,
      } as any);

    const token = jwt.sign(
      { id: 2, rol_id: 1 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .put('/medidas/4')
      .set('Authorization', `Bearer ${token}`)
      .send({
        faena_id: 3,
        descripcion: 'Cambio no autorizado',
      });

    expect(respuesta.status).toBe(409);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('impide cambiar la faena original de una medida', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 2,
      rol_id: 1,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValueOnce(1);

    const actualizar = vi.fn();

    vi.mocked(MedidaCorrectiva.findByPk)
      .mockResolvedValueOnce({
        id: 5,
        faena_id: 3,
        responsable_id: 23,
        update: actualizar,
      } as any);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce({
      id: 3,
      get: (campo: string) => ({
        empresa_id: 1,
        activo: true,
      } as Record<string, unknown>)[campo],
    } as any);

    const token = jwt.sign(
      { id: 2, rol_id: 1 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .put('/medidas/5')
      .set('Authorization', `Bearer ${token}`)
      .send({
        faena_id: 1,
        descripcion: 'Cambio de faena no autorizado',
      });

    expect(respuesta.status).toBe(403);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('impide eliminar una medida de otra empresa', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 2,
      rol_id: 1,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValueOnce(1);

    const eliminar = vi.fn();

    vi.mocked(MedidaCorrectiva.findByPk)
      .mockResolvedValueOnce({
        id: 90,
        faena_id: 8,
        destroy: eliminar,
      } as any);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce({
      id: 8,
      get: (campo: string) => ({
        empresa_id: 2,
        activo: true,
      } as Record<string, unknown>)[campo],
    } as any);

    const token = jwt.sign(
      { id: 2, rol_id: 1 },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

    const respuesta = await request(app)
      .delete('/medidas/90')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(403);
    expect(eliminar).not.toHaveBeenCalled();
  });

});
