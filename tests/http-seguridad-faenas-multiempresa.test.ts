import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Faena: {
    findAll: vi.fn(),
    findOne: vi.fn(),
    findByPk: vi.fn(),
    create: vi.fn(),
  },
  Empresa: {},
  Usuario: {
    findByPk: vi.fn(),
  },
}));

vi.mock('../src/services/autorizacionUsuariosInternos.service', () => {
  class ErrorAutorizacionUsuarioInterno extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorAutorizacionUsuarioInterno';
    }
  }

  return {
    obtenerEmpresaUsuarioInterno: vi.fn(),
    obtenerEmpresaAdministradorUsuarios: vi.fn(),
    ErrorAutorizacionUsuarioInterno,
  };
});

import { Faena, Usuario } from '../src/models';
import {
  obtenerEmpresaUsuarioInterno,
  obtenerEmpresaAdministradorUsuarios,
  ErrorAutorizacionUsuarioInterno,
} from '../src/services/autorizacionUsuariosInternos.service';
import faenasRoutes from '../src/routes/faena.routes';

const app = express();

app.use(express.json());
app.use('/api/faenas', faenasRoutes);

const listarFaenas = vi.mocked(Faena.findAll);

function tokenAdministrador(): string {
  const secreto = process.env.JWT_SECRET;

  if (!secreto || secreto.length < 32) {
    throw new Error('JWT_SECRET de pruebas inválido.');
  }

  return jwt.sign(
    { id: 11, rol_id: 1 },
    secreto,
    { expiresIn: '5m' }
  );
}

describe('HTTP - Seguridad multiempresa de faenas', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(obtenerEmpresaUsuarioInterno).mockResolvedValue(1);

    vi.mocked(obtenerEmpresaAdministradorUsuarios).mockResolvedValue(1);

    listarFaenas.mockResolvedValue([
      {
        id: 10,
        nombre: 'Faena de empresa 1',
        empresa_id: 1,
        activo: true,
      },
    ] as any);

    // Responsable autorizado: usuario 25 de la empresa 1.
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 25,
      activo: true,
      faena_id: 10,
      get: (campo: string) => ({
        activo: true,
        faena_id: 10,
      } as Record<string, unknown>)[campo],
    } as any);

    // Faena existente del responsable autorizado.
    vi.mocked(Faena.findByPk).mockResolvedValue({
      id: 10,
      empresa_id: 1,
      activo: true,
      get: (campo: string) =>
        campo === 'empresa_id' ? 1 : undefined,
    } as any);
  });

  describe('Consultas', () => {
    it('lista exclusivamente faenas activas de la empresa autorizada', async () => {
      const respuesta = await request(app)
        .get('/api/faenas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(200);

      expect(obtenerEmpresaUsuarioInterno)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(listarFaenas).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            activo: true,
            empresa_id: 1,
          }),
        })
      );
    });

    it('permite consultas a administradores y supervisores vigentes', async () => {
      const secreto = process.env.JWT_SECRET;

      if (!secreto || secreto.length < 32) {
        throw new Error('JWT_SECRET de pruebas inválido.');
      }

      const tokenSupervisor = jwt.sign(
        { id: 22, rol_id: 2 },
        secreto,
        { expiresIn: '5m' }
      );

      const administrador = await request(app)
        .get('/api/faenas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      const supervisor = await request(app)
        .get('/api/faenas')
        .set('Authorization', `Bearer ${tokenSupervisor}`);

      expect(administrador.status).toBe(200);
      expect(supervisor.status).toBe(200);

      expect(obtenerEmpresaUsuarioInterno)
        .toHaveBeenCalledWith(11);

      expect(obtenerEmpresaUsuarioInterno)
        .toHaveBeenCalledWith(22);

      expect(listarFaenas).toHaveBeenCalledTimes(2);
    });

    it('rechaza consultas sin autenticación', async () => {
      const respuesta = await request(app)
        .get('/api/faenas');

      expect(respuesta.status).toBe(401);
      expect(obtenerEmpresaUsuarioInterno).not.toHaveBeenCalled();
      expect(listarFaenas).not.toHaveBeenCalled();
    });

    it('rechaza usuarios con autorización interna revocada', async () => {
      vi.mocked(obtenerEmpresaUsuarioInterno).mockRejectedValueOnce(
        new ErrorAutorizacionUsuarioInterno(
          403,
          'Usuario sin autorización interna vigente.'
        )
      );

      const respuesta = await request(app)
        .get('/api/faenas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(403);
      expect(listarFaenas).not.toHaveBeenCalled();
    });
  });

  describe('Creación', () => {
    it('permite crear faenas únicamente a administradores vigentes', async () => {
      const crearFaena = vi.mocked(Faena.create);

      crearFaena.mockResolvedValueOnce({
        getDataValue: (campo: string) =>
          campo === 'id' ? 40 : undefined,
      } as any);

      const respuesta = await request(app)
        .post('/api/faenas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Faena de prueba',
          ubicacion: 'Ubicación de prueba',
          empresa_id: 1,
          responsable_id: 25,
        });

      expect(respuesta.status).toBe(201);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(crearFaena).toHaveBeenCalledTimes(1);
    });
    it('determina empresa_id desde la autorización del servidor', async () => {
      const crearFaena = vi.mocked(Faena.create);

      crearFaena.mockResolvedValueOnce({
        getDataValue: (campo: string) =>
          campo === 'id' ? 41 : undefined,
      } as any);

      const respuesta = await request(app)
        .post('/api/faenas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Faena de aislamiento',
          ubicacion: 'Ubicación de prueba',
          empresa_id: 3,
          responsable_id: 25,
        });

      expect(respuesta.status).toBe(201);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(crearFaena).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: 'Faena de aislamiento',
          empresa_id: 1,
        })
      );

      expect(crearFaena).not.toHaveBeenCalledWith(
        expect.objectContaining({
          empresa_id: 3,
        })
      );
    });
    it('rechaza responsables pertenecientes a otras empresas', async () => {
      const buscarResponsable = vi.mocked(Usuario.findByPk);
      const crearFaena = vi.mocked(Faena.create);

      crearFaena.mockResolvedValueOnce({
        getDataValue: (campo: string) =>
          campo === 'id' ? 42 : undefined,
      } as any);

      buscarResponsable.mockResolvedValueOnce({
        id: 90,
        activo: true,
        faena_id: 30,
        get: (campo: string) => ({
          activo: true,
          faena_id: 30,
        } as Record<string, unknown>)[campo],
      } as any);

      vi.mocked(Faena.findByPk).mockResolvedValueOnce({
        id: 30,
        empresa_id: 3,
        get: (campo: string) =>
          campo === 'empresa_id' ? 3 : undefined,
      } as any);

      const respuesta = await request(app)
        .post('/api/faenas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Faena con responsable ajeno',
          ubicacion: 'Ubicación de prueba',
          responsable_id: 90,
        });

      expect(respuesta.status).toBe(403);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(buscarResponsable)
        .toHaveBeenCalledWith(
          90,
          expect.any(Object)
        );

      expect(crearFaena).not.toHaveBeenCalled();
    });
    it('impide modificar campos administrativos protegidos', async () => {
      const crearFaena = vi.mocked(Faena.create);

      crearFaena.mockResolvedValueOnce({
        getDataValue: (campo: string) =>
          campo === 'id' ? 43 : undefined,
      } as any);

      const respuesta = await request(app)
        .post('/api/faenas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          id: 9999,
          nombre: 'Faena con campos manipulados',
          ubicacion: 'Ubicación de prueba',
          responsable_id: 25,
          empresa_id: 1,
          activo: false,
          fecha_creacion: '2001-01-01',
        });

      expect(respuesta.status).toBe(201);

      expect(crearFaena).toHaveBeenCalledTimes(1);

      const datosCreacion = crearFaena.mock.calls[0][0] as Record<string, unknown>;

      expect(datosCreacion).not.toHaveProperty('id');
      expect(datosCreacion).not.toHaveProperty('fecha_creacion');
      expect(datosCreacion.activo).toBe(true);
      expect(datosCreacion.empresa_id).toBe(1);
    });
  });

  describe('Actualización', () => {
    it('permite actualizar únicamente faenas de la empresa autorizada', async () => {
      const actualizar = vi.fn().mockResolvedValue(undefined);

      vi.mocked(Faena.findOne).mockResolvedValueOnce({
        id: 10,
        empresa_id: 1,
        activo: true,
        update: actualizar,
      } as any);

      const respuesta = await request(app)
        .put('/api/faenas/10')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Faena actualizada',
        });

      expect(respuesta.status).toBe(200);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Faena.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: expect.anything(),
            activo: true,
            empresa_id: 1,
          }),
        })
      );

      expect(actualizar).toHaveBeenCalledTimes(1);
    });
    it('rechaza modificaciones de faenas ajenas', async () => {
      const actualizar = vi.fn().mockResolvedValue(undefined);

      // El controlador vulnerable encontraría esta faena
      // si buscara solamente por ID.
      vi.mocked(Faena.findOne).mockImplementationOnce(
        async (opciones: any) => {
          if (Number(opciones?.where?.id) !== 30) {
            return null;
          }

          // La faena pertenece a empresa 3.
          // Una búsqueda segura para empresa 1 no debe encontrarla.
          if (opciones?.where?.empresa_id === 1) {
            return null;
          }

          return {
            id: 30,
            empresa_id: 3,
            activo: true,
            update: actualizar,
          } as any;
        }
      );

      const respuesta = await request(app)
        .put('/api/faenas/30')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Modificación no autorizada',
        });

      expect(respuesta.status).toBe(404);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Faena.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            empresa_id: 1,
            activo: true,
          }),
        })
      );

      expect(actualizar).not.toHaveBeenCalled();
    });
    it('impide trasladar faenas entre empresas', async () => {
      const actualizar = vi.fn().mockResolvedValue(undefined);

      vi.mocked(Faena.findOne).mockResolvedValueOnce({
        id: 10,
        empresa_id: 1,
        activo: true,
        update: actualizar,
      } as any);

      const respuesta = await request(app)
        .put('/api/faenas/10')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Faena actualizada',
          empresa_id: 3,
          id: 9999,
          activo: false,
          fecha_creacion: '2001-01-01',
        });

      expect(respuesta.status).toBe(200);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(actualizar).toHaveBeenCalledTimes(1);

      const datos = actualizar.mock.calls[0][0] as Record<string, unknown>;

      expect(datos.nombre).toBe('Faena actualizada');
      expect(datos).not.toHaveProperty('empresa_id');
      expect(datos).not.toHaveProperty('id');
      expect(datos).not.toHaveProperty('activo');
      expect(datos).not.toHaveProperty('fecha_creacion');
    });
    it('valida el responsable antes de actualizar', async () => {
      const actualizar = vi.fn().mockResolvedValue(undefined);

      vi.mocked(Faena.findOne).mockResolvedValueOnce({
        id: 10,
        empresa_id: 1,
        activo: true,
        update: actualizar,
      } as any);

      // Usuario 90 vinculado a una faena de empresa 3.
      vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
        id: 90,
        activo: true,
        faena_id: 30,
        get: (campo: string) => ({
          activo: true,
          faena_id: 30,
        } as Record<string, unknown>)[campo],
      } as any);

      vi.mocked(Faena.findByPk).mockResolvedValueOnce({
        id: 30,
        empresa_id: 3,
        get: (campo: string) =>
          campo === 'empresa_id' ? 3 : undefined,
      } as any);

      const respuesta = await request(app)
        .put('/api/faenas/10')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          responsable_id: 90,
        });

      expect(respuesta.status).toBe(403);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Usuario.findByPk).toHaveBeenCalledWith(
        90,
        expect.any(Object)
      );

      expect(actualizar).not.toHaveBeenCalled();
    });
  });

  describe('Desactivación', () => {
    it('permite desactivar únicamente faenas propias', async () => {
      const actualizar = vi.fn().mockResolvedValue(undefined);

      // Compatibilidad temporal con el controlador vulnerable:
      // actualmente utiliza findByPk sin filtrar por empresa.
      vi.mocked(Faena.findByPk).mockResolvedValueOnce({
        id: 10,
        empresa_id: 1,
        activo: true,
        update: actualizar,
      } as any);

      vi.mocked(Faena.findOne).mockResolvedValueOnce({
        id: 10,
        empresa_id: 1,
        activo: true,
        update: actualizar,
      } as any);

      const respuesta = await request(app)
        .delete('/api/faenas/10')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(200);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Faena.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 10,
            empresa_id: 1,
            activo: true,
          }),
        })
      );

      expect(actualizar).toHaveBeenCalledExactlyOnceWith({
        activo: false,
      });
    });
    it('rechaza la desactivación de faenas ajenas', async () => {
      const actualizar = vi.fn().mockResolvedValue(undefined);

      // El controlador vulnerable encuentra la faena por ID,
      // aunque pertenezca a otra empresa.
      vi.mocked(Faena.findByPk).mockResolvedValueOnce({
        id: 30,
        empresa_id: 3,
        activo: true,
        update: actualizar,
      } as any);

      // La búsqueda segura debe excluir la faena ajena.
      vi.mocked(Faena.findOne).mockImplementationOnce(
        async (opciones: any) => {
          if (
            Number(opciones?.where?.id) === 30 &&
            opciones?.where?.empresa_id === 1 &&
            opciones?.where?.activo === true
          ) {
            return null;
          }

          throw new Error('Consulta de faena inesperada.');
        }
      );

      const respuesta = await request(app)
        .delete('/api/faenas/30')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(404);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Faena.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 30,
            empresa_id: 1,
            activo: true,
          }),
        })
      );

      expect(actualizar).not.toHaveBeenCalled();
    });
    it('rechaza modificaciones realizadas por supervisores', async () => {
      const secreto = process.env.JWT_SECRET;

      if (!secreto || secreto.length < 32) {
        throw new Error('JWT_SECRET de pruebas inválido.');
      }

      const tokenSupervisor = jwt.sign(
        { id: 22, rol_id: 2 },
        secreto,
        { expiresIn: '5m' }
      );

      // Aunque el supervisor conozca una faena propia,
      // no debe poder desactivarla.
      const actualizar = vi.fn().mockResolvedValue(undefined);

      vi.mocked(Faena.findByPk).mockResolvedValueOnce({
        id: 10,
        empresa_id: 1,
        activo: true,
        update: actualizar,
      } as any);

      vi.mocked(obtenerEmpresaAdministradorUsuarios)
        .mockRejectedValueOnce(
          new ErrorAutorizacionUsuarioInterno(
            403,
            'Usuario sin permisos administrativos vigentes.'
          )
        );

      const respuesta = await request(app)
        .delete('/api/faenas/10')
        .set('Authorization', `Bearer ${tokenSupervisor}`);

      expect(respuesta.status).toBe(403);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(22);

      expect(Faena.findByPk).not.toHaveBeenCalled();
      expect(Faena.findOne).not.toHaveBeenCalled();
      expect(actualizar).not.toHaveBeenCalled();
    });
  });
});
