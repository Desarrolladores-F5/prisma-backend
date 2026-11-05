import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/models', () => ({
  Notificacion: {
    findAll: vi.fn(),
    findOne: vi.fn(),
  },
  Usuario: {
    findByPk: vi.fn(),
  },
  Faena: {},
}));

vi.mock('../src/middlewares/validarToken', () => ({
  validarToken: (req: any, _res: any, next: any) => {
    req.usuario = { id: 12, rol_id: 3 };
    next();
  },
}));

import { Notificacion, Usuario } from '../src/models';
import {
  obtenerMisNotificaciones,
  marcarComoLeida,
} from '../src/controllers/notificacion.controller';
import { validarToken } from '../src/middlewares/validarToken';

describe('Seguridad de notificaciones personales', () => {
  const app = express();

  app.use(express.json());
  app.get('/mis-notificaciones', validarToken, obtenerMisNotificaciones);
  app.put('/:id/leido', validarToken, marcarComoLeida);

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 12,
      activo: true,
    } as any);
  });

  it('consulta exclusivamente las notificaciones del usuario autenticado', async () => {
    vi.mocked(Notificacion.findAll).mockResolvedValueOnce([] as any);

    const respuesta = await request(app).get('/mis-notificaciones');

    expect(respuesta.status).toBe(200);

    expect(Usuario.findByPk).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        attributes: ['id', 'activo'],
      })
    );

    expect(Notificacion.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuario_id: 12,
          activo: true,
        },
      })
    );
  });

  it('impide consultar notificaciones a usuarios inactivos', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 12,
      activo: false,
    } as any);

    const respuesta = await request(app).get('/mis-notificaciones');

    expect(respuesta.status).toBe(403);
    expect(Notificacion.findAll).not.toHaveBeenCalled();
  });

  it('impide consultar notificaciones a usuarios inexistentes', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce(null);

    const respuesta = await request(app).get('/mis-notificaciones');

    expect(respuesta.status).toBe(403);
    expect(Notificacion.findAll).not.toHaveBeenCalled();
  });

  it('busca notificaciones por ID y propietario', async () => {
    vi.mocked(Notificacion.findOne).mockResolvedValueOnce(null);

    const respuesta = await request(app).put('/45/leido');

    expect(respuesta.status).toBe(404);

    expect(Notificacion.findOne).toHaveBeenCalledWith({
      where: {
        id: 45,
        usuario_id: 12,
        activo: true,
      },
    });
  });

  it('rechaza identificadores inválidos', async () => {
    const respuesta = await request(app).put('/abc/leido');

    expect(respuesta.status).toBe(400);
    expect(Notificacion.findOne).not.toHaveBeenCalled();
  });

  it('marca como leída una notificación propia', async () => {
    const guardar = vi.fn().mockResolvedValue(undefined);

    vi.mocked(Notificacion.findOne).mockResolvedValueOnce({
      id: 45,
      usuario_id: 12,
      leido: false,
      save: guardar,
    } as any);

    const respuesta = await request(app).put('/45/leido');

    expect(respuesta.status).toBe(200);
    expect(guardar).toHaveBeenCalledOnce();
    expect(respuesta.body.notificacion.leido).toBe(true);
  });

  it('impide marcar notificaciones cuando el usuario está inactivo', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 12,
      activo: false,
    } as any);

    const respuesta = await request(app).put('/45/leido');

    expect(respuesta.status).toBe(403);
    expect(Notificacion.findOne).not.toHaveBeenCalled();
  });

  it('impide marcar como leídas notificaciones ajenas', async () => {
    vi.mocked(Notificacion.findOne).mockResolvedValueOnce(null);

    const respuesta = await request(app).put('/99/leido');

    expect(respuesta.status).toBe(404);
    expect(Notificacion.findOne).toHaveBeenCalledWith({
      where: {
        id: 99,
        usuario_id: 12,
        activo: true,
      },
    });
  });
});
