import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';

vi.mock('../src/models', () => ({
  Notificacion: {
    findAll: vi.fn(),
    findOne: vi.fn(),
  },
  Usuario: {
    findByPk: vi.fn(),
  },
  Faena: {
    findAll: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
}));

import router from '../src/routes/notificacion.routes';
import { Notificacion, Usuario, Faena } from '../src/models';
import {
  obtenerEmpresaAdministrador,
} from '../src/services/asignacionDocumental.service';

describe('Aislamiento HTTP de notificaciones', () => {
  const app = express();

  app.use(express.json());
  app.use('/notificaciones', router);

  const token = (id: number, rol_id: number) =>
    jwt.sign(
      { id, rol_id },
      process.env.JWT_SECRET || 'clave_secreta',
      { expiresIn: '5m' }
    );

  const filtroFaenas = () => {
    const opciones = vi.mocked(Notificacion.findAll).mock.calls[0][0] as any;
    const condiciones = opciones.where[Op.and];
    return condiciones[1].faena_id[Op.in];
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Notificacion.findAll).mockResolvedValue([] as any);

    vi.mocked(Usuario.findByPk).mockImplementation(
      async (id: any) => {
        const usuarios: Record<number, any> = {
          2: { id: 2, rol_id: 1, activo: true, faena_id: 3 },
          9: { id: 9, rol_id: 2, activo: true, faena_id: 3 },
          29: { id: 29, rol_id: 2, activo: true, faena_id: 1 },
          31: { id: 31, rol_id: 3, activo: true, faena_id: 3 },
          4: { id: 4, rol_id: 1, activo: false, faena_id: null },
        };

        return usuarios[Number(id)] ?? null;
      }
    );

    vi.mocked(Faena.findAll).mockResolvedValue([
      { get: () => 1 },
      { get: () => 3 },
    ] as any);

    vi.mocked(Faena.findOne).mockImplementation(
      async (opciones: any) => {
        const id = Number(opciones?.where?.id);
        return [1, 3].includes(id) ? ({ id } as any) : null;
      }
    );

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValue(1);
  });

  it('rechaza consultas administrativas sin JWT', async () => {
    const respuesta = await request(app).get('/notificaciones');

    expect(respuesta.status).toBe(401);
    expect(Notificacion.findAll).not.toHaveBeenCalled();
  });

  it('limita al administrador a las faenas de su empresa', async () => {
    const respuesta = await request(app)
      .get('/notificaciones')
      .set('Authorization', `Bearer ${token(2, 1)}`);

    expect(respuesta.status).toBe(200);
    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(2);

    expect(Faena.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          empresa_id: 1,
          activo: true,
        },
      })
    );

    expect(filtroFaenas()).toEqual([1, 3]);
  });

  it('limita al supervisor 29 a la faena 1', async () => {
    const respuesta = await request(app)
      .get('/notificaciones')
      .set('Authorization', `Bearer ${token(29, 2)}`);

    expect(respuesta.status).toBe(200);
    expect(filtroFaenas()).toEqual([1]);
  });

  it('limita al supervisor 9 a la faena 3', async () => {
    const respuesta = await request(app)
      .get('/notificaciones')
      .set('Authorization', `Bearer ${token(9, 2)}`);

    expect(respuesta.status).toBe(200);
    expect(filtroFaenas()).toEqual([3]);
  });

  it('rechaza al trabajador en el listado administrativo', async () => {
    const respuesta = await request(app)
      .get('/notificaciones')
      .set('Authorization', `Bearer ${token(31, 3)}`);

    expect(respuesta.status).toBe(403);
    expect(Notificacion.findAll).not.toHaveBeenCalled();
  });

  it('rechaza a un administrador inactivo', async () => {
    const respuesta = await request(app)
      .get('/notificaciones')
      .set('Authorization', `Bearer ${token(4, 1)}`);

    expect(respuesta.status).toBe(403);
    expect(Notificacion.findAll).not.toHaveBeenCalled();
  });

  it('impide modificar una notificación fuera del ámbito autorizado', async () => {
    vi.mocked(Notificacion.findOne).mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .put('/notificaciones/90')
      .set('Authorization', `Bearer ${token(2, 1)}`)
      .send({ mensaje: 'Cambio no autorizado' });

    expect(respuesta.status).toBe(404);

    const opciones = vi.mocked(Notificacion.findOne).mock.calls[0][0] as any;

    expect(opciones.where.id).toBe(90);
    expect(opciones.where[Op.and][0].faena_id[Op.in]).toEqual([1, 3]);
  });

  it('impide editar una notificación automática', async () => {
    const actualizar = vi.fn();

    vi.mocked(Notificacion.findOne).mockResolvedValueOnce({
      id: 80,
      origen: 'epp',
      clave_evento: 'epp:3:2026-06-23:vencido',
      update: actualizar,
    } as any);

    const respuesta = await request(app)
      .put('/notificaciones/80')
      .set('Authorization', `Bearer ${token(2, 1)}`)
      .send({ mensaje: 'Mensaje modificado' });

    expect(respuesta.status).toBe(403);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('impide eliminar una notificación automática', async () => {
    const actualizar = vi.fn();

    vi.mocked(Notificacion.findOne).mockResolvedValueOnce({
      id: 81,
      origen: 'documentos',
      clave_evento: 'recepcion_documental:81',
      update: actualizar,
    } as any);

    const respuesta = await request(app)
      .delete('/notificaciones/81')
      .set('Authorization', `Bearer ${token(2, 1)}`);

    expect(respuesta.status).toBe(403);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('permite editar una notificación manual autorizada', async () => {
    const notificacion = {
      id: 82,
      origen: 'manual',
      clave_evento: null,
      mensaje: 'Mensaje original',
      update: vi.fn().mockImplementation(async function(this: any, cambios) {
        Object.assign(this, cambios);
      }),
    };

    vi.mocked(Notificacion.findOne).mockResolvedValueOnce(
      notificacion as any
    );

    const respuesta = await request(app)
      .put('/notificaciones/82')
      .set('Authorization', `Bearer ${token(2, 1)}`)
      .send({ mensaje: 'Mensaje actualizado' });

    expect(respuesta.status).toBe(200);
    expect(notificacion.update).toHaveBeenCalledWith({
      mensaje: 'Mensaje actualizado',
    });
  });

});
