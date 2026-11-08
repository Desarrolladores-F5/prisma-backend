import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Empresa: {
    findByPk: vi.fn(),
  },
  Faena: {
    findByPk: vi.fn(),
  },
  ContratoExterno: {
    findByPk: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
}));

import { Empresa, Faena, ContratoExterno } from '../src/models';
import { obtenerEmpresaAdministrador } from '../src/services/asignacionDocumental.service';
import {
  crearContratoExterno,
  ErrorContratoExterno,
  SolicitudCrearContratoExterno,
} from '../src/services/contratosExternos.service';

describe('Seguridad multiempresa de contratos externos', () => {
  const solicitudBase: SolicitudCrearContratoExterno = {
    administradorId: 10,
    contratistaEmpresaId: 2,
    faenaId: 5,
    nombre: 'Contrato de mantenimiento',
    numeroContrato: 'CT-001',
    fechaInicio: '2026-11-01',
    fechaTermino: '2027-11-01',
  };

  const crearEmpresaSimulada = (activo: boolean) => ({
    get: vi.fn((campo: string) => {
      if (campo === 'activo') return activo;
      return undefined;
    }),
  });

  const crearFaenaSimulada = (
    empresaId: number,
    activo = true
  ) => ({
    get: vi.fn((campo: string) => {
      if (campo === 'empresa_id') return empresaId;
      if (campo === 'activo') return activo;
      return undefined;
    }),
  });

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValue(1);

    vi.mocked(Empresa.findByPk)
      .mockImplementation(async () =>
        crearEmpresaSimulada(true) as any
      );

    vi.mocked(Faena.findByPk)
      .mockResolvedValue(
        crearFaenaSimulada(1) as any
      );

    vi.mocked(ContratoExterno.findByPk)
      .mockResolvedValue(null);

    vi.mocked(ContratoExterno.create)
      .mockImplementation(async (datos) => ({
        id: 100,
        ...datos,
      }) as any);
  });

  it('crea un contrato autorizado con estado pendiente', async () => {
    const resultado = await crearContratoExterno(solicitudBase);

    expect(obtenerEmpresaAdministrador)
      .toHaveBeenCalledWith(10);

    expect(ContratoExterno.create)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          mandante_empresa_id: 1,
          contratista_empresa_id: 2,
          faena_id: 5,
          nombre: 'Contrato de mantenimiento',
          estado: 'pendiente',
        })
      );

    expect(resultado.estado).toBe('pendiente');
  });

  it('rechaza al administrador sin autorización', async () => {
    vi.mocked(obtenerEmpresaAdministrador)
      .mockRejectedValue(new Error('No autorizado'));

    await expect(
      crearContratoExterno(solicitudBase)
    ).rejects.toThrow('No autorizado');

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza identificadores inválidos', async () => {
    await expect(
      crearContratoExterno({
        ...solicitudBase,
        contratistaEmpresaId: -2,
      })
    ).rejects.toBeInstanceOf(ErrorContratoExterno);

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('impide contratar a la misma empresa mandante', async () => {
    await expect(
      crearContratoExterno({
        ...solicitudBase,
        contratistaEmpresaId: 1,
      })
    ).rejects.toThrow(
      'La mandante y la contratista deben ser empresas distintas.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza una empresa mandante inactiva', async () => {
    vi.mocked(Empresa.findByPk)
      .mockImplementation(async (id) =>
        crearEmpresaSimulada(Number(id) !== 1) as any
      );

    await expect(
      crearContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'La empresa mandante no está habilitada.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza una empresa contratista inactiva', async () => {
    vi.mocked(Empresa.findByPk)
      .mockImplementation(async (id) =>
        crearEmpresaSimulada(Number(id) !== 2) as any
      );

    await expect(
      crearContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'La empresa contratista no existe o no está activa.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza una empresa contratista inexistente', async () => {
    vi.mocked(Empresa.findByPk)
      .mockImplementation(async (id) =>
        Number(id) === 2
          ? null
          : crearEmpresaSimulada(true) as any
      );

    await expect(
      crearContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'La empresa contratista no existe o no está activa.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('impide registrar contratos en faenas de otra mandante', async () => {
    vi.mocked(Faena.findByPk)
      .mockResolvedValue(
        crearFaenaSimulada(99) as any
      );

    await expect(
      crearContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'La faena no pertenece a la mandante o no está activa.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza una faena inactiva', async () => {
    vi.mocked(Faena.findByPk)
      .mockResolvedValue(
        crearFaenaSimulada(1, false) as any
      );

    await expect(
      crearContratoExterno(solicitudBase)
    ).rejects.toThrow(
      'La faena no pertenece a la mandante o no está activa.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza un contrato principal de otra mandante', async () => {
    vi.mocked(ContratoExterno.findByPk)
      .mockResolvedValue({
        id: 50,
        mandante_empresa_id: 99,
        contratista_empresa_id: 3,
        faena_id: 5,
      } as any);

    await expect(
      crearContratoExterno({
        ...solicitudBase,
        contratoPrincipalId: 50,
      })
    ).rejects.toThrow(
      'El contrato principal no corresponde a la mandante y faena indicadas.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza subcontratar a la misma contratista principal', async () => {
    vi.mocked(ContratoExterno.findByPk)
      .mockResolvedValue({
        id: 50,
        mandante_empresa_id: 1,
        contratista_empresa_id: 2,
        faena_id: 5,
      } as any);

    await expect(
      crearContratoExterno({
        ...solicitudBase,
        contratoPrincipalId: 50,
      })
    ).rejects.toThrow(
      'La subcontratista debe ser distinta de la contratista principal.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza fechas inválidas o invertidas', async () => {
    await expect(
      crearContratoExterno({
        ...solicitudBase,
        fechaInicio: '2026-02-30',
      })
    ).rejects.toBeInstanceOf(ErrorContratoExterno);

    await expect(
      crearContratoExterno({
        ...solicitudBase,
        fechaInicio: '2027-01-01',
        fechaTermino: '2026-12-31',
      })
    ).rejects.toThrow(
      'La fecha de término no puede ser anterior a la de inicio.'
    );

    expect(ContratoExterno.create)
      .not.toHaveBeenCalled();
  });
});
