// tests/seguridad-mis-empresas-externas.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Op } from 'sequelize';

vi.mock('../src/models', () => ({
  Usuario: { findByPk: vi.fn() },
  UsuarioEmpresaExterna: { findAll: vi.fn() },
  Empresa: { findAll: vi.fn() },
}));

import {
  Usuario,
  UsuarioEmpresaExterna,
  Empresa,
} from '../src/models';

import {
  obtenerMisEmpresasExternas,
  ErrorConsultaMisEmpresasExternas,
} from '../src/services/misEmpresasExternas.service';

const empresa = (id: number, nombre: string) => ({
  get: (campo: string) => {
    if (campo === 'id') return id;
    if (campo === 'nombre') return nombre;
    return undefined;
  },
});

describe('Seguridad - Mis Empresas Externas', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 10,
      activo: true,
    } as any);

    vi.mocked(UsuarioEmpresaExterna.findAll)
      .mockResolvedValue([]);

    vi.mocked(Empresa.findAll)
      .mockResolvedValue([]);
  });

  it('rechaza identificadores inválidos', async () => {
    for (const id of [0, -1, 1.5, NaN, Infinity]) {
      await expect(
        obtenerMisEmpresasExternas(id)
      ).rejects.toBeInstanceOf(
        ErrorConsultaMisEmpresasExternas
      );
    }

    expect(Usuario.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza usuarios inexistentes', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue(null);

    await expect(
      obtenerMisEmpresasExternas(10)
    ).rejects.toMatchObject({
      estadoHttp: 403,
    });

    expect(UsuarioEmpresaExterna.findAll)
      .not.toHaveBeenCalled();
  });

  it('rechaza usuarios inactivos', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 10,
      activo: false,
    } as any);

    await expect(
      obtenerMisEmpresasExternas(10)
    ).rejects.toThrow(
      'Usuario sin autorización vigente.'
    );
  });

  it('consulta únicamente vinculaciones activas del usuario', async () => {
    await obtenerMisEmpresasExternas(10);

    expect(UsuarioEmpresaExterna.findAll)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            usuario_id: 10,
            activo: true,
            perfil: {
              [Op.in]: [
                'administrador_externo',
                'trabajador',
              ],
            },
          },
          attributes: ['empresa_id', 'perfil'],
        })
      );
  });

  it('devuelve lista vacía sin vinculaciones', async () => {
    const resultado = await obtenerMisEmpresasExternas(10);

    expect(resultado).toEqual({ empresas: [] });
    expect(Empresa.findAll).not.toHaveBeenCalled();
  });

  it('devuelve solamente empresas activas y datos mínimos', async () => {
    vi.mocked(UsuarioEmpresaExterna.findAll)
      .mockResolvedValue([
        {
          empresa_id: 3,
          perfil: 'administrador_externo',
        },
      ] as any);

    vi.mocked(Empresa.findAll)
      .mockResolvedValue([
        empresa(3, 'Empresa Contratista'),
      ] as any);

    const resultado = await obtenerMisEmpresasExternas(10);

    expect(resultado).toEqual({
      empresas: [
        {
          empresaId: 3,
          nombre: 'Empresa Contratista',
          perfil: 'administrador_externo',
        },
      ],
    });

    expect(Empresa.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { [Op.in]: [3] },
          activo: true,
        },
        attributes: ['id', 'nombre'],
      })
    );
  });

  it('excluye empresas inactivas', async () => {
    vi.mocked(UsuarioEmpresaExterna.findAll)
      .mockResolvedValue([
        { empresa_id: 3, perfil: 'administrador_externo' },
        { empresa_id: 4, perfil: 'administrador_externo' },
      ] as any);

    vi.mocked(Empresa.findAll)
      .mockResolvedValue([
        empresa(3, 'Empresa Activa'),
      ] as any);

    const resultado = await obtenerMisEmpresasExternas(10);

    expect(resultado.empresas).toHaveLength(1);
    expect(resultado.empresas[0].empresaId).toBe(3);
  });

  it('no convierte trabajadores en administradores', async () => {
    vi.mocked(UsuarioEmpresaExterna.findAll)
      .mockResolvedValue([
        { empresa_id: 3, perfil: 'trabajador' },
      ] as any);

    vi.mocked(Empresa.findAll)
      .mockResolvedValue([
        empresa(3, 'Empresa Contratista'),
      ] as any);

    const resultado = await obtenerMisEmpresasExternas(10);

    expect(resultado.empresas[0].perfil).toBe('trabajador');
  });

  it('evita consultas duplicadas de la misma empresa', async () => {
    vi.mocked(UsuarioEmpresaExterna.findAll)
      .mockResolvedValue([
        { empresa_id: 3, perfil: 'administrador_externo' },
        { empresa_id: 3, perfil: 'trabajador' },
      ] as any);

    vi.mocked(Empresa.findAll)
      .mockResolvedValue([
        empresa(3, 'Empresa Contratista'),
      ] as any);

    const resultado = await obtenerMisEmpresasExternas(10);

    expect(resultado.empresas).toHaveLength(2);

    expect(Empresa.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { [Op.in]: [3] },
          activo: true,
        },
      })
    );
  });
});
