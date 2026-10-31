import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/models', () => ({
  Notificacion: {
    findAll: vi.fn(),
    findOne: vi.fn(),
  },
  Usuario: {},
  Faena: {},
}));

vi.mock('../src/middlewares/validarToken', () => ({
  validarToken: (req: any, _res: any, next: any) => {
    req.usuario = { id: 12, rol_id: 3 };
    next();
  },
}));

import { Notificacion } from '../src/models';
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
  });

  it('consulta exclusivamente las notificaciones del usuario autenticado', async () => {
    vi.mocked(Notificacion.findAll).mockResolvedValueOnce([] as any);

    const respuesta = await request(app).get('/mis-notificaciones');

    expect(respuesta.status).toBe(200);
    expect(Notificacion.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { usuario_id: 12, activo: true },
      })
    );
  });

  it('busca la notificación por ID y propietario', async () => {
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
});
