import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Usuario: {
    findAll: vi.fn(),
    findByPk: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  Rol: {},
  Faena: {
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

import {
  obtenerEmpresaUsuarioInterno,
  obtenerEmpresaAdministradorUsuarios,
  ErrorAutorizacionUsuarioInterno,
} from '../src/services/autorizacionUsuariosInternos.service';

import { Usuario, Faena } from '../src/models';
import usuariosRoutes from '../src/routes/usuario.routes';

const app = express();
app.use(express.json());
app.use('/api/usuarios', usuariosRoutes);

const listar = vi.mocked(Usuario.findAll);
const buscarPorId = vi.mocked(Usuario.findByPk);
const crear = vi.mocked(Usuario.create);
const contar = vi.mocked(Usuario.count);
const buscarFaena = vi.mocked(Faena.findByPk);

const usuarioSimulado = {
  id: 25,
  rut: '11111111-1',
  nombre: 'Usuario',
  apellido: 'Prueba',
  correo: 'usuario-prueba@example.invalid',
  rol_id: 3,
  faena_id: 3,
  activo: true,
  contraseña_hash: 'HASH_SECRETO_DE_PRUEBA',
  salt: 'SALT_SECRETO_DE_PRUEBA',
  update: vi.fn(),
};

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

describe('HTTP - Protección de credenciales de usuarios', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    listar.mockResolvedValue([usuarioSimulado] as any);
    buscarPorId.mockResolvedValue(usuarioSimulado as any);
    crear.mockResolvedValue(usuarioSimulado as any);
    contar.mockResolvedValue(3);

    buscarFaena.mockResolvedValue({
      id: 3,
      empresa_id: 1,
      get: (campo: string) =>
        campo === 'empresa_id' ? 1 : undefined,
    } as any);

    vi.mocked(
      obtenerEmpresaUsuarioInterno
    ).mockResolvedValue(1);

    vi.mocked(
      obtenerEmpresaAdministradorUsuarios
    ).mockResolvedValue(1);
  });

  it('cuenta solamente usuarios activos de la empresa autenticada', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios/conteo/total')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ total: 3 });

    expect(obtenerEmpresaUsuarioInterno)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(contar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activo: true,
        }),
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );
  });

  it('rechaza el conteo si el acceso interno fue revocado', async () => {
    vi.mocked(obtenerEmpresaUsuarioInterno).mockRejectedValueOnce(
      new ErrorAutorizacionUsuarioInterno(
        403,
        'Usuario sin autorización interna vigente.'
      )
    );

    const respuesta = await request(app)
      .get('/api/usuarios/conteo/total')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(403);

    expect(obtenerEmpresaUsuarioInterno)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(contar).not.toHaveBeenCalled();
  });

  it('no expone hash ni salt al listar usuarios', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toHaveLength(1);

    expect(respuesta.body[0]).not.toHaveProperty('contraseña_hash');
    expect(respuesta.body[0]).not.toHaveProperty('salt');

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          exclude: expect.arrayContaining([
            'contraseña_hash',
            'salt',
          ]),
        }),
      })
    );
  });

  it('no devuelve hash ni salt al crear un usuario', async () => {
    const respuesta = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('rut', '11111111-1')
      .field('nombre', 'Usuario')
      .field('apellido', 'Prueba')
      .field('correo', 'usuario-prueba@example.invalid')
      .field('rol_id', '3')
      .field('faena_id', '3')
      .field('tipo_contrato', 'Indefinido')
      .field('contraseña', 'ClaveSoloParaPrueba123!');

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.usuario).toBeDefined();

    expect(respuesta.body.usuario).not.toHaveProperty('contraseña_hash');
    expect(respuesta.body.usuario).not.toHaveProperty('salt');

    expect(JSON.stringify(respuesta.body)).not.toContain(
      'HASH_SECRETO_DE_PRUEBA'
    );
  });



  it('ignora campos administrativos no autorizados al crear usuarios', async () => {
    const respuesta = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('rut', '33333333-3')
      .field('nombre', 'Persona')
      .field('apellido', 'Prueba')
      .field('correo', 'seguridad@example.invalid')
      .field('rol_id', '3')
      .field('faena_id', '3')
      .field('tipo_contrato', 'Indefinido')
      .field('contraseña', 'ClaveSoloParaPrueba123!')
      .field('activo', 'false')
      .field('fecha_creacion', '2001-01-01')
      .field('id', '9999')
      .field('empresa_id', '2')
      .field('contraseña_hash', 'HASH_INYECTADO')
      .field('salt', 'SALT_INYECTADO');

    expect(respuesta.status).toBe(201);
    expect(crear).toHaveBeenCalledOnce();

    const datosCreacion = crear.mock.calls[0][0] as Record<string, unknown>;

    expect(datosCreacion).not.toHaveProperty('id');
    expect(datosCreacion).not.toHaveProperty('empresa_id');
    expect(datosCreacion).not.toHaveProperty('fecha_creacion');
    expect(datosCreacion).not.toHaveProperty('activo');

    expect(datosCreacion.contraseña_hash).not.toBe('HASH_INYECTADO');
    expect(datosCreacion.salt).not.toBe('SALT_INYECTADO');
    expect(datosCreacion.faena_id).toBe(3);
  });

  it('rechaza crear usuarios en una faena de otra empresa', async () => {
    buscarFaena.mockResolvedValueOnce({
      id: 5,
      empresa_id: 2,
      get: (campo: string) =>
        campo === 'empresa_id' ? 2 : undefined,
    } as any);

    const respuesta = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('rut', '22222222-2')
      .field('nombre', 'Persona')
      .field('apellido', 'Externa')
      .field('correo', 'externa@example.invalid')
      .field('rol_id', '3')
      .field('faena_id', '5')
      .field('tipo_contrato', 'Indefinido')
      .field('contraseña', 'ClaveSoloParaPrueba123!');

    expect(respuesta.status).toBe(403);

    expect(
      obtenerEmpresaAdministradorUsuarios
    ).toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarFaena).toHaveBeenCalled();

    expect(crear).not.toHaveBeenCalled();
  });




  it('impide modificar campos administrativos protegidos', async () => {
    const respuesta = await request(app)
      .put('/api/usuarios/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('rut', '11111111-1')
      .field('nombre', 'Usuario Actualizado')
      .field('apellido', 'Prueba')
      .field('correo', 'usuario-prueba@example.invalid')
      .field('rol_id', '3')
      .field('faena_id', '3')
      .field('tipo_contrato', 'Indefinido')
      .field('activo', 'false')
      .field('id', '9999')
      .field('fecha_creacion', '2001-01-01')
      .field('empresa_id', '2')
      .field('contraseña_hash', 'HASH_INYECTADO')
      .field('salt', 'SALT_INYECTADO');

    expect(respuesta.status).toBe(200);
    expect(usuarioSimulado.update).toHaveBeenCalledOnce();

    const datosActualizacion = (
      vi.mocked(usuarioSimulado.update).mock.calls[0][0]
    ) as Record<string, unknown>;

    for (const campo of [
      'id',
      'activo',
      'fecha_creacion',
      'empresa_id',
      'contraseña_hash',
      'salt',
    ]) {
      expect(datosActualizacion).not.toHaveProperty(campo);
    }

    expect(datosActualizacion.nombre).toBe('Usuario Actualizado');
    expect(datosActualizacion.faena_id).toBe(3);
  });

  it('impide trasladar usuarios a faenas de otra empresa', async () => {
    buscarFaena.mockResolvedValueOnce({
      id: 5,
      empresa_id: 2,
      get: (campo: string) =>
        campo === 'empresa_id' ? 2 : undefined,
    } as any);

    const respuesta = await request(app)
      .put('/api/usuarios/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('rut', '11111111-1')
      .field('nombre', 'Usuario')
      .field('apellido', 'Prueba')
      .field('correo', 'usuario-prueba@example.invalid')
      .field('rol_id', '3')
      .field('faena_id', '5')
      .field('tipo_contrato', 'Indefinido');

    expect(respuesta.status).toBe(403);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarFaena).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        attributes: expect.arrayContaining([
          'id',
          'empresa_id',
        ]),
      })
    );

    expect(usuarioSimulado.update).not.toHaveBeenCalled();
  });

  it('impide actualizar usuarios de otra empresa', async () => {
    buscarPorId.mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .put('/api/usuarios/34')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('rut', '22222222-2')
      .field('nombre', 'Persona')
      .field('apellido', 'Externa')
      .field('correo', 'externa@example.invalid')
      .field('rol_id', '3')
      .field('faena_id', '5')
      .field('tipo_contrato', 'Indefinido');

    expect(respuesta.status).toBe(404);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).toHaveBeenCalledWith(
      '34',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );

    expect(usuarioSimulado.update).not.toHaveBeenCalled();
  });


  it('rechaza crear usuarios con permisos administrativos revocados', async () => {
    vi.mocked(obtenerEmpresaAdministradorUsuarios).mockRejectedValueOnce(
      new ErrorAutorizacionUsuarioInterno(
        403,
        'Usuario sin permisos administrativos vigentes.'
      )
    );

    const respuesta = await request(app)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('rut', '44444444-4')
      .field('nombre', 'Usuario')
      .field('apellido', 'Prueba')
      .field('correo', 'revocado@example.invalid')
      .field('rol_id', '3')
      .field('faena_id', '3')
      .field('tipo_contrato', 'Indefinido')
      .field('contraseña', 'ClaveSoloParaPrueba123!');

    expect(respuesta.status).toBe(403);
    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);
    expect(crear).not.toHaveBeenCalled();
  });

  it('rechaza actualizar usuarios con permisos administrativos revocados', async () => {
    vi.mocked(obtenerEmpresaAdministradorUsuarios).mockRejectedValueOnce(
      new ErrorAutorizacionUsuarioInterno(
        403,
        'Usuario sin permisos administrativos vigentes.'
      )
    );

    const respuesta = await request(app)
      .put('/api/usuarios/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`)
      .field('nombre', 'Usuario Actualizado')
      .field('rol_id', '3')
      .field('faena_id', '3')
      .field('tipo_contrato', 'Indefinido');

    expect(respuesta.status).toBe(403);
    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);
    expect(usuarioSimulado.update).not.toHaveBeenCalled();
  });


  it('impide desactivar usuarios de otra empresa', async () => {
    buscarPorId.mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .delete('/api/usuarios/34')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(404);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).toHaveBeenCalledWith(
      '34',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );

    expect(usuarioSimulado.update).not.toHaveBeenCalled();
  });

  it('impide reactivar usuarios de otra empresa', async () => {
    buscarPorId.mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .put('/api/usuarios/reactivar/34')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(404);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).toHaveBeenCalledWith(
      '34',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );

    expect(usuarioSimulado.update).not.toHaveBeenCalled();
  });


  it('permite desactivar usuarios de la propia empresa', async () => {
    const respuesta = await request(app)
      .delete('/api/usuarios/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).toHaveBeenCalledWith(
      '25',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: { empresa_id: 1 },
          }),
        ]),
      })
    );

    expect(usuarioSimulado.update)
      .toHaveBeenCalledExactlyOnceWith({ activo: false });
  });

  it('permite reactivar usuarios inactivos de la propia empresa', async () => {
    buscarPorId.mockResolvedValueOnce({
      ...usuarioSimulado,
      activo: false,
    } as any);

    const respuesta = await request(app)
      .put('/api/usuarios/reactivar/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).toHaveBeenCalledWith(
      '25',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: { empresa_id: 1 },
          }),
        ]),
      })
    );

    expect(usuarioSimulado.update)
      .toHaveBeenCalledExactlyOnceWith({ activo: true });
  });

  it('rechaza desactivar usuarios con permisos administrativos revocados', async () => {
    vi.mocked(obtenerEmpresaAdministradorUsuarios).mockRejectedValueOnce(
      new ErrorAutorizacionUsuarioInterno(
        403,
        'Usuario sin permisos administrativos vigentes.'
      )
    );

    const respuesta = await request(app)
      .delete('/api/usuarios/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(403);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).not.toHaveBeenCalled();
    expect(usuarioSimulado.update).not.toHaveBeenCalled();
  });

  it('rechaza reactivar usuarios con permisos administrativos revocados', async () => {
    vi.mocked(obtenerEmpresaAdministradorUsuarios).mockRejectedValueOnce(
      new ErrorAutorizacionUsuarioInterno(
        403,
        'Usuario sin permisos administrativos vigentes.'
      )
    );

    const respuesta = await request(app)
      .put('/api/usuarios/reactivar/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(403);

    expect(obtenerEmpresaAdministradorUsuarios)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).not.toHaveBeenCalled();
    expect(usuarioSimulado.update).not.toHaveBeenCalled();
  });

  it('no expone credenciales al consultar un usuario por ID', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);

    expect(respuesta.body).not.toHaveProperty('contraseña_hash');
    expect(respuesta.body).not.toHaveProperty('salt');

    expect(buscarPorId).toHaveBeenCalledWith(
      '25',
      expect.objectContaining({
        attributes: expect.objectContaining({
          exclude: expect.arrayContaining([
            'contraseña_hash',
            'salt',
          ]),
        }),
      })
    );
  });

  it('no expone credenciales al listar usuarios por faena', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios/faena/3')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toHaveLength(1);

    expect(respuesta.body[0]).not.toHaveProperty('contraseña_hash');
    expect(respuesta.body[0]).not.toHaveProperty('salt');

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          exclude: expect.arrayContaining([
            'contraseña_hash',
            'salt',
          ]),
        }),
      })
    );
  });


  it('restringe la consulta por ID a la empresa autenticada', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios/25')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);

    expect(
      obtenerEmpresaUsuarioInterno
    ).toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).toHaveBeenCalledWith(
      '25',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );
  });

  it('restringe la consulta por faena a la empresa autenticada', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios/faena/3')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);

    expect(
      obtenerEmpresaUsuarioInterno
    ).toHaveBeenCalledExactlyOnceWith(11);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activo: true,
          faena_id: '3',
        }),
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );
  });


  it('no entrega datos al consultar un usuario de otra empresa', async () => {
    buscarPorId.mockResolvedValueOnce(null);

    const respuesta = await request(app)
      .get('/api/usuarios/34')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(404);
    expect(respuesta.body).not.toHaveProperty('id');
    expect(respuesta.body).not.toHaveProperty('correo');

    expect(obtenerEmpresaUsuarioInterno)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(buscarPorId).toHaveBeenCalledWith(
      '34',
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );
  });

  it('no entrega usuarios al consultar una faena de otra empresa', async () => {
    listar.mockResolvedValueOnce([] as any);

    const respuesta = await request(app)
      .get('/api/usuarios/faena/5')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual([]);

    expect(obtenerEmpresaUsuarioInterno)
      .toHaveBeenCalledExactlyOnceWith(11);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activo: true,
          faena_id: '5',
        }),
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );
  });

  it('restringe el listado a la empresa real del administrador', async () => {
    const respuesta = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdministrador()}`);

    expect(respuesta.status).toBe(200);

    expect(
      obtenerEmpresaUsuarioInterno
    ).toHaveBeenCalledExactlyOnceWith(11);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activo: true,
        }),
        include: expect.arrayContaining([
          expect.objectContaining({
            as: 'faena',
            required: true,
            where: expect.objectContaining({
              empresa_id: 1,
            }),
          }),
        ]),
      })
    );
  });
});
