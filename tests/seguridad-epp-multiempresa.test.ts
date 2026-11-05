import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';

// Simulamos los modelos para evitar operaciones reales en MySQL.
vi.mock('../src/models', () => ({
  EPP: {
    findAll: vi.fn(),
    findByPk: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  Usuario: {
    findByPk: vi.fn(),
  },
  Faena: {
    findAll: vi.fn(),
    findByPk: vi.fn(),
  },
  Documento: {
    findByPk: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
}));

vi.mock('../src/services/notificacionesAutomaticas.service', () => ({
  avisarEntregaEPP: vi.fn(),
}));

import router from '../src/routes/epp.routes';
import { EPP, Usuario, Faena, Documento } from '../src/models';
import { obtenerEmpresaAdministrador } from '../src/services/asignacionDocumental.service';
import { avisarEntregaEPP } from '../src/services/notificacionesAutomaticas.service';

const app = express();
app.use(express.json());
app.use('/epp', router);

const token = (id: number, rol_id = 1): string =>
  jwt.sign(
    { id, rol_id },
    process.env.JWT_SECRET || 'clave_secreta',
    { expiresIn: '5m' }
  );

const faenaSimulada = (
  id: number,
  empresaId: number,
  activo = true
) => ({
  id,
  get: (campo: string) => ({
    id,
    empresa_id: empresaId,
    activo,
  } as Record<string, unknown>)[campo],
});

const datosEPP = {
  usuario_id: 23,
  faena_id: 3,
  tipo: 'Casco de seguridad',
  descripcion: 'Casco industrial',
  fecha_entrega: '2026-11-05',
  fecha_vencimiento: '2027-11-05',
  estado: 'Nuevo',
};

describe('Seguridad multiempresa del módulo EPP', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rechaza consultas sin autenticación', async () => {
    const respuesta = await request(app).get('/epp');

    expect(respuesta.status).toBe(401);
    expect(EPP.findAll).not.toHaveBeenCalled();
  });

  it('impide que un trabajador acceda al listado administrativo', async () => {
    const respuesta = await request(app)
      .get('/epp')
      .set('Authorization', `Bearer ${token(23, 3)}`);

    expect(respuesta.status).toBe(403);
    expect(EPP.findAll).not.toHaveBeenCalled();
  });

  it('filtra los EPP por las faenas de la empresa autorizada', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(Faena.findAll).mockResolvedValueOnce([
      faenaSimulada(3, 1),
      faenaSimulada(4, 1),
    ] as any);

    vi.mocked(EPP.findAll).mockResolvedValueOnce([] as any);

    const respuesta = await request(app)
      .get('/epp')
      .set('Authorization', `Bearer ${token(2)}`);

    expect(respuesta.status).toBe(200);
    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(2);

    expect(Faena.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { empresa_id: 1 },
      })
    );

    const opciones = vi.mocked(EPP.findAll).mock.calls[0][0] as any;

    expect(opciones.where.activo).toBe(true);
    expect(opciones.where.faena_id[Op.in]).toEqual([3, 4]);
  });

  it('rechaza crear un EPP en una faena de otra empresa', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce(
      faenaSimulada(3, 2) as any
    );

    const respuesta = await request(app)
      .post('/epp')
      .set('Authorization', `Bearer ${token(2)}`)
      .send(datosEPP);

    expect(respuesta.status).toBe(403);
    expect(EPP.create).not.toHaveBeenCalled();
    expect(avisarEntregaEPP).not.toHaveBeenCalled();
  });

  it('rechaza crear un EPP para un trabajador de otra faena', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce(
      faenaSimulada(3, 1) as any
    );

    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 23,
      activo: true,
      faena_id: 8,
    } as any);

    const respuesta = await request(app)
      .post('/epp')
      .set('Authorization', `Bearer ${token(2)}`)
      .send(datosEPP);

    expect(respuesta.status).toBe(400);
    expect(EPP.create).not.toHaveBeenCalled();
  });

  it('rechaza asociar documentos de otra empresa', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce(
      faenaSimulada(3, 1) as any
    );

    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 23,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(Documento.findByPk).mockResolvedValueOnce({
      id: 90,
      empresa_id: 2,
    } as any);

    const respuesta = await request(app)
      .post('/epp')
      .set('Authorization', `Bearer ${token(2)}`)
      .send({ ...datosEPP, documento_id: 90 });

    expect(respuesta.status).toBe(403);
    expect(EPP.create).not.toHaveBeenCalled();
  });

  it('impide actualizar EPP de otra empresa', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(EPP.findByPk).mockResolvedValueOnce({
      id: 50,
      activo: true,
      faena_id: 8,
      usuario_id: 30,
    } as any);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce(
      faenaSimulada(8, 2) as any
    );

    const respuesta = await request(app)
      .put('/epp/50')
      .set('Authorization', `Bearer ${token(2)}`)
      .send({ estado: 'vigente' });

    expect(respuesta.status).toBe(404);
    expect(EPP.update).not.toHaveBeenCalled();
  });

  it('impide eliminar EPP de otra empresa', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    const actualizar = vi.fn();

    vi.mocked(EPP.findByPk).mockResolvedValueOnce({
      id: 50,
      activo: true,
      faena_id: 8,
      update: actualizar,
    } as any);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce(
      faenaSimulada(8, 2) as any
    );

    const respuesta = await request(app)
      .delete('/epp/50')
      .set('Authorization', `Bearer ${token(2)}`);

    expect(respuesta.status).toBe(404);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('permite registrar un EPP válido y solicita su notificación', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValueOnce(1);

    vi.mocked(Faena.findByPk).mockResolvedValueOnce(
      faenaSimulada(3, 1) as any
    );

    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 23,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(EPP.create).mockResolvedValueOnce({
      id: 100,
      tipo: 'Casco de seguridad',
      usuario_id: 23,
      faena_id: 3,
    } as any);

    vi.mocked(avisarEntregaEPP).mockResolvedValueOnce(undefined as any);

    const respuesta = await request(app)
      .post('/epp')
      .set('Authorization', `Bearer ${token(2)}`)
      .send(datosEPP);

    expect(respuesta.status).toBe(201);
    expect(EPP.create).toHaveBeenCalledOnce();

    expect(avisarEntregaEPP).toHaveBeenCalledWith({
      eppId: 100,
      trabajadorId: 23,
      faenaId: 3,
      tipo: 'Casco de seguridad',
    });
  });

  it('permite al trabajador consultar únicamente sus EPP', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 23,
      rol_id: 3,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(EPP.findAll).mockResolvedValueOnce([] as any);

    const respuesta = await request(app)
      .get('/epp/mis-epp')
      .set('Authorization', `Bearer ${token(23, 3)}`);

    expect(respuesta.status).toBe(200);

    expect(EPP.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuario_id: 23,
          activo: true,
        },
      })
    );
  });
});
