import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Usuario: {
    findByPk: vi.fn(),
  },
  ContratoExterno: {
    findByPk: vi.fn(),
  },
  UsuarioEmpresaExterna: {
    findOne: vi.fn(),
  },
}));

import {
  Usuario,
  ContratoExterno,
  UsuarioEmpresaExterna,
} from '../src/models';

import {
  autorizarAdministradorContratoExterno,
  ErrorAutorizacionEmpresaExterna,
} from '../src/services/autorizacionEmpresasExternas.service';

describe('Seguridad de autorización de empresas externas', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 10,
      activo: true,
    } as any);

    vi.mocked(ContratoExterno.findByPk).mockResolvedValue({
      id: 50,
      contratista_empresa_id: 3,
    } as any);

    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue({
      id: 100,
      usuario_id: 10,
      empresa_id: 3,
      perfil: 'administrador_externo',
      activo: true,
    } as any);
  });

  it('autoriza a un administrador de su propia contratista', async () => {
    const resultado = await autorizarAdministradorContratoExterno(
      10,
      50
    );

    expect(resultado).toEqual({
      usuarioId: 10,
      empresaId: 3,
      contratoId: 50,
    });

    expect(UsuarioEmpresaExterna.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuario_id: 10,
          empresa_id: 3,
          perfil: 'administrador_externo',
          activo: true,
        },
      })
    );
  });

  it('rechaza identificadores inválidos', async () => {
    await expect(
      autorizarAdministradorContratoExterno(-1, 50)
    ).rejects.toBeInstanceOf(ErrorAutorizacionEmpresaExterna);

    await expect(
      autorizarAdministradorContratoExterno(10, 0)
    ).rejects.toBeInstanceOf(ErrorAutorizacionEmpresaExterna);

    expect(Usuario.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza usuarios inexistentes', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue(null);

    await expect(
      autorizarAdministradorContratoExterno(10, 50)
    ).rejects.toThrow('Usuario sin autorización vigente.');

    expect(ContratoExterno.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza usuarios inactivos', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 10,
      activo: false,
    } as any);

    await expect(
      autorizarAdministradorContratoExterno(10, 50)
    ).rejects.toThrow('Usuario sin autorización vigente.');

    expect(ContratoExterno.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza contratos inexistentes', async () => {
    vi.mocked(ContratoExterno.findByPk).mockResolvedValue(null);

    await expect(
      autorizarAdministradorContratoExterno(10, 50)
    ).rejects.toThrow('Contrato no encontrado.');

    expect(UsuarioEmpresaExterna.findOne).not.toHaveBeenCalled();
  });

  it('rechaza administradores de otra contratista', async () => {
    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue(null);

    await expect(
      autorizarAdministradorContratoExterno(10, 50)
    ).rejects.toThrow(
      'No tiene autorización para administrar este contrato.'
    );

    expect(UsuarioEmpresaExterna.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          empresa_id: 3,
        }),
      })
    );
  });

  it('rechaza vinculaciones empresariales inactivas', async () => {
    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue(null);

    await expect(
      autorizarAdministradorContratoExterno(10, 50)
    ).rejects.toBeInstanceOf(ErrorAutorizacionEmpresaExterna);

    expect(UsuarioEmpresaExterna.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activo: true,
        }),
      })
    );
  });

  it('no concede administración a perfiles de trabajador', async () => {
    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue(null);

    await expect(
      autorizarAdministradorContratoExterno(10, 50)
    ).rejects.toThrow(
      'No tiene autorización para administrar este contrato.'
    );

    expect(UsuarioEmpresaExterna.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          perfil: 'administrador_externo',
        }),
      })
    );
  });

  it('comprueba la empresa real del contrato solicitado', async () => {
    vi.mocked(ContratoExterno.findByPk).mockResolvedValue({
      id: 99,
      contratista_empresa_id: 7,
    } as any);

    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue(null);

    await expect(
      autorizarAdministradorContratoExterno(10, 99)
    ).rejects.toThrow(
      'No tiene autorización para administrar este contrato.'
    );

    expect(UsuarioEmpresaExterna.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          empresa_id: 7,
        }),
      })
    );
  });
});
