// tests/http-seguridad-empresas-multiempresa.test.ts

import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Empresa: {
    findAll: vi.fn(),
    findByPk: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
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

import { Empresa } from '../src/models';
import {
  obtenerEmpresaUsuarioInterno,
  obtenerEmpresaAdministradorUsuarios,
  ErrorAutorizacionUsuarioInterno,
} from '../src/services/autorizacionUsuariosInternos.service';
import empresasRoutes from '../src/routes/empresa.routes';

function simularConsultaEmpresas(registros: any[]) {
  return (async (opciones: any) => {
    const filtros = opciones?.where ?? {};

    return registros.filter((empresa) => {
      if (
        filtros.id !== undefined &&
        empresa.id !== filtros.id
      ) {
        return false;
      }

      if (
        filtros.activo !== undefined &&
        empresa.activo !== filtros.activo
      ) {
        return false;
      }

      return true;
    });
  }) as any;
}

const app = express();
app.use(express.json());
app.use('/api/empresas', empresasRoutes);

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

describe('HTTP - Seguridad multiempresa de empresas', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(obtenerEmpresaUsuarioInterno).mockResolvedValue(1);

    vi.mocked(Empresa.findAll).mockImplementation(
      simularConsultaEmpresas([
        { id: 1, nombre: 'Empresa F5', activo: true },
        { id: 3, nombre: 'Empresa ajena', activo: true },
      ])
    );
  });

  describe('Consultas', () => {
    it('permite consultar únicamente la empresa interna autorizada', async () => {
      const respuesta = await request(app)
        .get('/api/empresas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(200);

      expect(obtenerEmpresaUsuarioInterno)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Empresa.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 1,
            activo: true,
          }),
        })
      );

      expect(respuesta.body).toEqual([
        expect.objectContaining({ id: 1 }),
      ]);
    });
    it('rechaza consultas sin autenticación', async () => {
      const respuesta = await request(app)
        .get('/api/empresas');

      expect(respuesta.status).toBe(401);

      expect(obtenerEmpresaUsuarioInterno)
        .not.toHaveBeenCalled();

      expect(Empresa.findAll)
        .not.toHaveBeenCalled();
    });
    it('rechaza usuarios con autorización interna revocada', async () => {
      vi.mocked(obtenerEmpresaUsuarioInterno).mockRejectedValueOnce(
        new ErrorAutorizacionUsuarioInterno(
          403,
          'Usuario sin autorización interna vigente.'
        )
      );

      const respuesta = await request(app)
        .get('/api/empresas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(403);

      expect(obtenerEmpresaUsuarioInterno)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Empresa.findAll)
        .not.toHaveBeenCalled();
    });
    it('no expone información administrativa de empresas ajenas', async () => {
      vi.mocked(Empresa.findAll).mockImplementationOnce(
        simularConsultaEmpresas([
          {
            id: 1,
            nombre: 'Empresa autorizada',
            rut: '11111111-1',
            correo: 'contacto@empresa-autorizada.test',
            activo: true,
          },
          {
            id: 3,
            nombre: 'Empresa ajena',
            rut: '33333333-3',
            correo: 'privado@empresa-ajena.test',
            activo: true,
          },
        ])
      );

      const respuesta = await request(app)
        .get('/api/empresas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(200);
      expect(Array.isArray(respuesta.body)).toBe(true);

      const ids = respuesta.body.map(
        (empresa: { id: number }) => empresa.id
      );

      expect(ids).toEqual([1]);

      const contenidoRespuesta = JSON.stringify(respuesta.body);

      expect(contenidoRespuesta).not.toContain('Empresa ajena');
      expect(contenidoRespuesta).not.toContain('33333333-3');
      expect(contenidoRespuesta).not.toContain(
        'privado@empresa-ajena.test'
      );
    });
  });

  describe('Creación', () => {
    it('rechaza la creación por supervisores', async () => {
      const secreto = process.env.JWT_SECRET;

      if (!secreto || secreto.length < 32) {
        throw new Error('JWT_SECRET de pruebas inválido.');
      }

      const tokenSupervisor = jwt.sign(
        { id: 22, rol_id: 2 },
        secreto,
        { expiresIn: '5m' }
      );

      const respuesta = await request(app)
        .post('/api/empresas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          nombre: 'Empresa no autorizada',
          rut: '99999999-9',
          activo: true,
        });

      expect(respuesta.status).toBe(403);

      expect(Empresa.create)
        .not.toHaveBeenCalled();
    });
    it('rechaza la creación global sin autorización explícita', async () => {
      const respuesta = await request(app)
        .post('/api/empresas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Nueva empresa global',
          rut: '88888888-8',
          activo: true,
        });

      expect(respuesta.status).toBe(403);

      expect(Empresa.create)
        .not.toHaveBeenCalled();

      expect(obtenerEmpresaAdministradorUsuarios)
        .not.toHaveBeenCalled();
    });
    it('impide modificar campos administrativos protegidos', async () => {
      const respuesta = await request(app)
        .post('/api/empresas')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Empresa no autorizada',
          rut: '77777777-7',
          id: 999,
          activo: false,
          fecha_creacion: '2020-01-01',
        });

      expect(respuesta.status).toBe(403);

      expect(Empresa.create)
        .not.toHaveBeenCalled();

      expect(Empresa.update)
        .not.toHaveBeenCalled();
    });
  });

  describe('Actualización', () => {
    it('permite actualizar únicamente campos autorizados de la empresa propia', async () => {
      vi.mocked(obtenerEmpresaAdministradorUsuarios)
        .mockResolvedValueOnce(1);

      vi.mocked(Empresa.update).mockResolvedValueOnce([1] as any);

      vi.mocked(Empresa.findByPk).mockResolvedValueOnce({
        id: 1,
        nombre: 'Empresa F5 actualizada',
        activo: true,
      } as any);

      const respuesta = await request(app)
        .put('/api/empresas/1')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Empresa F5 actualizada',
          direccion: 'Nueva dirección',
        });

      expect(respuesta.status).toBe(200);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Empresa.update).toHaveBeenCalledWith(
        {
          nombre: 'Empresa F5 actualizada',
          direccion: 'Nueva dirección',
        },
        expect.objectContaining({
          where: expect.objectContaining({
            id: 1,
            activo: true,
          }),
        })
      );

      expect(respuesta.body).toEqual(
        expect.objectContaining({
          id: 1,
          nombre: 'Empresa F5 actualizada',
        })
      );
    });
    it('rechaza modificaciones de empresas ajenas', async () => {
      vi.mocked(obtenerEmpresaAdministradorUsuarios)
        .mockResolvedValueOnce(1);

      const respuesta = await request(app)
        .put('/api/empresas/3')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Modificación no autorizada',
          direccion: 'Dirección manipulada',
        });

      expect(respuesta.status).toBe(403);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Empresa.update)
        .not.toHaveBeenCalled();

      expect(Empresa.findByPk)
        .not.toHaveBeenCalled();
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

      vi.mocked(obtenerEmpresaAdministradorUsuarios)
        .mockRejectedValueOnce(
          new ErrorAutorizacionUsuarioInterno(
            403,
            'Usuario sin autorización administrativa vigente.'
          )
        );

      const respuesta = await request(app)
        .put('/api/empresas/1')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          nombre: 'Cambio no autorizado',
        });

      expect(respuesta.status).toBe(403);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(22);

      expect(Empresa.update)
        .not.toHaveBeenCalled();

      expect(Empresa.findByPk)
        .not.toHaveBeenCalled();
    });
    it('impide modificar id, activo y fecha_creacion', async () => {
      vi.mocked(obtenerEmpresaAdministradorUsuarios)
        .mockResolvedValueOnce(1);

      vi.mocked(Empresa.update)
        .mockResolvedValueOnce([1] as any);

      vi.mocked(Empresa.findByPk)
        .mockResolvedValueOnce({
          id: 1,
          nombre: 'Empresa F5 actualizada',
          activo: true,
        } as any);

      const respuesta = await request(app)
        .put('/api/empresas/1')
        .set('Authorization', `Bearer ${tokenAdministrador()}`)
        .send({
          nombre: 'Empresa F5 actualizada',
          id: 3,
          activo: false,
          fecha_creacion: '2020-01-01',
        });

      expect(respuesta.status).toBe(200);

      expect(obtenerEmpresaAdministradorUsuarios)
        .toHaveBeenCalledExactlyOnceWith(11);

      expect(Empresa.update).toHaveBeenCalledWith(
        { nombre: 'Empresa F5 actualizada' },
        expect.objectContaining({
          where: expect.objectContaining({
            id: 1,
            activo: true,
          }),
        })
      );

      expect(respuesta.body.id).toBe(1);
      expect(respuesta.body.activo).toBe(true);
    });
  });

  describe('Desactivación', () => {
    it('rechaza desactivaciones de empresas ajenas', async () => {
      const respuesta = await request(app)
        .delete('/api/empresas/3')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(403);

      expect(Empresa.update)
        .not.toHaveBeenCalled();

      expect(Empresa.findByPk)
        .not.toHaveBeenCalled();
    });
    it('rechaza desactivaciones realizadas por supervisores', async () => {
      const secreto = process.env.JWT_SECRET;

      if (!secreto || secreto.length < 32) {
        throw new Error('JWT_SECRET de pruebas inválido.');
      }

      const tokenSupervisor = jwt.sign(
        { id: 22, rol_id: 2 },
        secreto,
        { expiresIn: '5m' }
      );

      const respuesta = await request(app)
        .delete('/api/empresas/1')
        .set('Authorization', `Bearer ${tokenSupervisor}`);

      expect(respuesta.status).toBe(403);

      expect(Empresa.update)
        .not.toHaveBeenCalled();

      expect(Empresa.findByPk)
        .not.toHaveBeenCalled();
    });
    it('rechaza desactivaciones globales sin autorización explícita', async () => {
      const respuesta = await request(app)
        .delete('/api/empresas/1')
        .set('Authorization', `Bearer ${tokenAdministrador()}`);

      expect(respuesta.status).toBe(403);

      expect(Empresa.update)
        .not.toHaveBeenCalled();

      expect(Empresa.findByPk)
        .not.toHaveBeenCalled();

      expect(obtenerEmpresaAdministradorUsuarios)
        .not.toHaveBeenCalled();
    });
  });
});
