import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Usuario: {
    findByPk: vi.fn(),
  },
  Faena: {
    findByPk: vi.fn(),
  },
}));

import { Usuario, Faena } from '../src/models';

import {
  obtenerEmpresaUsuarioInterno,
  obtenerEmpresaAdministradorUsuarios,
  ErrorAutorizacionUsuarioInterno,
} from '../src/services/autorizacionUsuariosInternos.service';

describe('Seguridad de autorización de usuarios internos', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 11,
      rol_id: 1,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(Faena.findByPk).mockResolvedValue({
      id: 3,
      empresa_id: 1,
      get: (campo: string) =>
        campo === 'empresa_id' ? 1 : undefined,
    } as any);
  });

  it('identifica la empresa real de un administrador activo', async () => {
    await expect(
      obtenerEmpresaUsuarioInterno(11)
    ).resolves.toBe(1);

    expect(Usuario.findByPk).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        attributes: expect.arrayContaining([
          'id',
          'rol_id',
          'activo',
          'faena_id',
        ]),
      })
    );
  });

  it('permite identificar la empresa de un supervisor activo', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 9,
      rol_id: 2,
      activo: true,
      faena_id: 3,
    } as any);

    await expect(
      obtenerEmpresaUsuarioInterno(9)
    ).resolves.toBe(1);
  });


  it('autoriza la administración con rol vigente 1 en MySQL', async () => {
    await expect(
      obtenerEmpresaAdministradorUsuarios(11)
    ).resolves.toBe(1);

    expect(Usuario.findByPk).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        attributes: expect.arrayContaining([
          'id',
          'rol_id',
          'activo',
          'faena_id',
        ]),
      })
    );
  });

  it('rechaza permisos administrativos revocados en MySQL', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 11,
      rol_id: 2,
      activo: true,
      faena_id: 3,
    } as any);

    await expect(
      obtenerEmpresaAdministradorUsuarios(11)
    ).rejects.toBeInstanceOf(ErrorAutorizacionUsuarioInterno);

    expect(Faena.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza identificadores inválidos', async () => {
    await expect(
      obtenerEmpresaUsuarioInterno(0)
    ).rejects.toBeInstanceOf(ErrorAutorizacionUsuarioInterno);

    expect(Usuario.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza usuarios inexistentes o inactivos', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue(null);

    await expect(
      obtenerEmpresaUsuarioInterno(11)
    ).rejects.toBeInstanceOf(ErrorAutorizacionUsuarioInterno);

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 11,
      rol_id: 1,
      activo: false,
      faena_id: 3,
    } as any);

    await expect(
      obtenerEmpresaUsuarioInterno(11)
    ).rejects.toBeInstanceOf(ErrorAutorizacionUsuarioInterno);
  });

  it('rechaza usuarios externos y trabajadores', async () => {
    for (const rol of [3, 4]) {
      vi.mocked(Usuario.findByPk).mockResolvedValue({
        id: 34,
        rol_id: rol,
        activo: true,
        faena_id: 5,
      } as any);

      await expect(
        obtenerEmpresaUsuarioInterno(34)
      ).rejects.toBeInstanceOf(ErrorAutorizacionUsuarioInterno);
    }

    expect(Faena.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza usuarios sin faena válida', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 11,
      rol_id: 1,
      activo: true,
      faena_id: null,
    } as any);

    await expect(
      obtenerEmpresaUsuarioInterno(11)
    ).rejects.toBeInstanceOf(ErrorAutorizacionUsuarioInterno);

    expect(Faena.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza faenas sin empresa válida', async () => {
    vi.mocked(Faena.findByPk).mockResolvedValue(null);

    await expect(
      obtenerEmpresaUsuarioInterno(11)
    ).rejects.toBeInstanceOf(ErrorAutorizacionUsuarioInterno);
  });
});
