import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Usuario: {
    findByPk: vi.fn(),
  },
  UsuarioEmpresaExterna: {
    findOne: vi.fn(),
  },
  ContratoExternoTrabajador: {
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../src/services/autorizacionEmpresasExternas.service', () => ({
  autorizarAdministradorContratoExterno: vi.fn(),
}));

import {
  Usuario,
  UsuarioEmpresaExterna,
  ContratoExternoTrabajador,
} from '../src/models';

import {
  autorizarAdministradorContratoExterno,
} from '../src/services/autorizacionEmpresasExternas.service';

import {
  vincularTrabajadorContratoExterno,
  ErrorTrabajadorContratoExterno,
} from '../src/services/trabajadoresContratosExternos.service';

describe('Seguridad de trabajadores en contratos externos', () => {
  const solicitudBase = {
    administradorId: 10,
    contratoId: 50,
    trabajadorId: 21,
    fechaIncorporacion: '2026-11-08',
    fechaDesvinculacion: '2026-12-31',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(autorizarAdministradorContratoExterno)
      .mockResolvedValue({
        usuarioId: 10,
        empresaId: 3,
        contratoId: 50,
      });

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 21,
      activo: true,
    } as any);

    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue({
      id: 100,
      usuario_id: 21,
      empresa_id: 3,
      activo: true,
    } as any);

    vi.mocked(ContratoExternoTrabajador.findOne)
      .mockResolvedValue(null);

    vi.mocked(ContratoExternoTrabajador.create)
      .mockImplementation(async (datos) => ({
        id: 200,
        ...datos,
      }) as any);
  });

  it('vincula correctamente un trabajador autorizado', async () => {
    const resultado = await vincularTrabajadorContratoExterno(
      solicitudBase
    );

    expect(resultado.contrato_id).toBe(50);
    expect(resultado.usuario_id).toBe(21);
    expect(resultado.activo).toBe(true);

    expect(ContratoExternoTrabajador.create)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          contrato_id: 50,
          usuario_id: 21,
          activo: true,
        }),
        {}
      );
  });

  it('rechaza identificadores inválidos', async () => {
    await expect(
      vincularTrabajadorContratoExterno({
        ...solicitudBase,
        trabajadorId: -1,
      })
    ).rejects.toBeInstanceOf(ErrorTrabajadorContratoExterno);

    expect(autorizarAdministradorContratoExterno)
      .not.toHaveBeenCalled();
  });

  it('rechaza administradores sin permiso sobre el contrato', async () => {
    vi.mocked(autorizarAdministradorContratoExterno)
      .mockRejectedValue(new Error('Acceso denegado'));

    await expect(
      vincularTrabajadorContratoExterno(solicitudBase)
    ).rejects.toThrow('Acceso denegado');

    expect(Usuario.findByPk).not.toHaveBeenCalled();
    expect(ContratoExternoTrabajador.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza trabajadores inexistentes', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue(null);

    await expect(
      vincularTrabajadorContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'El trabajador no existe o está inactivo.'
    );

    expect(ContratoExternoTrabajador.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza trabajadores inactivos', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 21,
      activo: false,
    } as any);

    await expect(
      vincularTrabajadorContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'El trabajador no existe o está inactivo.'
    );

    expect(ContratoExternoTrabajador.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza trabajadores de otra contratista', async () => {
    vi.mocked(UsuarioEmpresaExterna.findOne)
      .mockResolvedValue(null);

    await expect(
      vincularTrabajadorContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'El trabajador no pertenece a la empresa contratista.'
    );

    expect(UsuarioEmpresaExterna.findOne)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            usuario_id: 21,
            empresa_id: 3,
            activo: true,
          },
        })
      );

    expect(ContratoExternoTrabajador.create)
      .not.toHaveBeenCalled();
  });

  it('requiere una vinculación empresarial activa', async () => {
    vi.mocked(UsuarioEmpresaExterna.findOne)
      .mockResolvedValue(null);

    await expect(
      vincularTrabajadorContratoExterno(solicitudBase)
    ).rejects.toBeInstanceOf(ErrorTrabajadorContratoExterno);

    expect(UsuarioEmpresaExterna.findOne)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            activo: true,
          }),
        })
      );
  });

  it('rechaza trabajadores ya vinculados al contrato', async () => {
    vi.mocked(ContratoExternoTrabajador.findOne)
      .mockResolvedValue({
        id: 99,
        contrato_id: 50,
        usuario_id: 21,
      } as any);

    await expect(
      vincularTrabajadorContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'El trabajador ya está vinculado a este contrato.'
    );

    expect(ContratoExternoTrabajador.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza fechas de incorporación inválidas', async () => {
    await expect(
      vincularTrabajadorContratoExterno({
        ...solicitudBase,
        fechaIncorporacion: '2026-02-30',
      })
    ).rejects.toBeInstanceOf(ErrorTrabajadorContratoExterno);

    expect(ContratoExternoTrabajador.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza fechas de desvinculación anteriores a la incorporación', async () => {
    await expect(
      vincularTrabajadorContratoExterno({
        ...solicitudBase,
        fechaIncorporacion: '2026-12-31',
        fechaDesvinculacion: '2026-11-08',
      })
    ).rejects.toThrow(
      'La fecha de desvinculación no puede ser anterior a la incorporación.'
    );

    expect(ContratoExternoTrabajador.create)
      .not.toHaveBeenCalled();
  });

  it('utiliza la misma transacción en autorización, consultas y creación', async () => {
    const transaction = { id: 'transaccion-prueba' } as any;

    await vincularTrabajadorContratoExterno({
      ...solicitudBase,
      transaction,
    });

    expect(autorizarAdministradorContratoExterno)
      .toHaveBeenCalledWith(10, 50, { transaction });

    expect(Usuario.findByPk).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ transaction })
    );

    expect(UsuarioEmpresaExterna.findOne)
      .toHaveBeenCalledWith(
        expect.objectContaining({ transaction })
      );

    expect(ContratoExternoTrabajador.findOne)
      .toHaveBeenCalledWith(
        expect.objectContaining({ transaction })
      );

    expect(ContratoExternoTrabajador.create)
      .toHaveBeenCalledWith(
        expect.any(Object),
        { transaction }
      );
  });
});
