import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  AcreditacionDocumentalExterna: {
    findByPk: vi.fn(),
  },
  ContratoExterno: {
    findByPk: vi.fn(),
  },
  Empresa: {
    findByPk: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
}));

import {
  AcreditacionDocumentalExterna,
  ContratoExterno,
  Empresa,
} from '../src/models';

import {
  obtenerEmpresaAdministrador,
} from '../src/services/asignacionDocumental.service';

import {
  autorizarRevisionDocumentalExterna,
  ErrorAutorizacionRevisionExterna,
} from '../src/services/autorizacionRevisionDocumentalExterna.service';

describe('Seguridad de autorización de revisión documental externa', () => {
  const solicitudBase = {
    administradorId: 2,
    acreditacionId: 100,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValue(1);

    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        id: 100,
        contrato_id: 50,
      } as any);

    vi.mocked(ContratoExterno.findByPk)
      .mockResolvedValue({
        id: 50,
        mandante_empresa_id: 1,
      } as any);

    vi.mocked(Empresa.findByPk)
      .mockResolvedValue({
        id: 1,
        get: vi.fn().mockReturnValue(true),
      } as any);
  });

  it('autoriza al administrador de la mandante correcta', async () => {
    const resultado = await autorizarRevisionDocumentalExterna(
      solicitudBase
    );

    expect(resultado).toEqual({
      administradorId: 2,
      acreditacionId: 100,
      contratoId: 50,
      mandanteEmpresaId: 1,
    });
  });

  it('rechaza identificadores inválidos', async () => {
    await expect(
      autorizarRevisionDocumentalExterna({
        administradorId: -1,
        acreditacionId: 100,
      })
    ).rejects.toBeInstanceOf(ErrorAutorizacionRevisionExterna);

    expect(obtenerEmpresaAdministrador).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de acreditación inválidos', async () => {
    await expect(
      autorizarRevisionDocumentalExterna({
        administradorId: 2,
        acreditacionId: 0,
      })
    ).rejects.toThrow(
      'Identificadores de revisión documental inválidos.'
    );

    expect(AcreditacionDocumentalExterna.findByPk)
      .not.toHaveBeenCalled();
  });

  it('rechaza usuarios sin permisos de administrador de mandante', async () => {
    vi.mocked(obtenerEmpresaAdministrador)
      .mockRejectedValue(new Error('Administrador sin autorización'));

    await expect(
      autorizarRevisionDocumentalExterna(solicitudBase)
    ).rejects.toThrow('Administrador sin autorización');

    expect(AcreditacionDocumentalExterna.findByPk)
      .not.toHaveBeenCalled();
  });

  it('rechaza acreditaciones inexistentes', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue(null);

    await expect(
      autorizarRevisionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'Acreditación documental no encontrada.'
    );

    expect(ContratoExterno.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza contratos inexistentes', async () => {
    vi.mocked(ContratoExterno.findByPk)
      .mockResolvedValue(null);

    await expect(
      autorizarRevisionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'Contrato de la acreditación no encontrado.'
    );

    expect(Empresa.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza administradores de otra mandante', async () => {
    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValue(4);

    await expect(
      autorizarRevisionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'No tiene autorización para revisar esta acreditación.'
    );

    expect(Empresa.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza a un administrador de la contratista', async () => {
    vi.mocked(obtenerEmpresaAdministrador)
      .mockResolvedValue(3);

    await expect(
      autorizarRevisionDocumentalExterna({
        administradorId: 9,
        acreditacionId: 100,
      })
    ).rejects.toThrow(
      'No tiene autorización para revisar esta acreditación.'
    );
  });

  it('rechaza empresas mandantes inexistentes', async () => {
    vi.mocked(Empresa.findByPk).mockResolvedValue(null);

    await expect(
      autorizarRevisionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'La empresa mandante no está habilitada.'
    );
  });

  it('rechaza empresas mandantes inactivas', async () => {
    vi.mocked(Empresa.findByPk)
      .mockResolvedValue({
        id: 1,
        get: vi.fn().mockReturnValue(false),
      } as any);

    await expect(
      autorizarRevisionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'La empresa mandante no está habilitada.'
    );
  });

  it('consulta la acreditación con sus campos necesarios', async () => {
    await autorizarRevisionDocumentalExterna(solicitudBase);

    expect(AcreditacionDocumentalExterna.findByPk)
      .toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          attributes: ['id', 'contrato_id'],
        })
      );

    expect(ContratoExterno.findByPk)
      .toHaveBeenCalledWith(
        50,
        expect.objectContaining({
          attributes: ['id', 'mandante_empresa_id'],
        })
      );
  });

  it('propaga la transacción a todas las consultas de autorización', async () => {
    const transaction = { id: 'transaccion-prueba' } as any;

    await autorizarRevisionDocumentalExterna({
      ...solicitudBase,
      transaction,
    });

    // La identidad y empresa del administrador
    // deben verificarse en la misma transacción.
    expect(obtenerEmpresaAdministrador)
      .toHaveBeenCalledWith(
        2,
        expect.objectContaining({ transaction })
      );

    expect(AcreditacionDocumentalExterna.findByPk)
      .toHaveBeenCalledWith(
        100,
        expect.objectContaining({ transaction })
      );

    expect(ContratoExterno.findByPk)
      .toHaveBeenCalledWith(
        50,
        expect.objectContaining({ transaction })
      );

    expect(Empresa.findByPk)
      .toHaveBeenCalledWith(
        1,
        expect.objectContaining({ transaction })
      );
  });

  it('mantiene compatibilidad cuando no se proporciona transacción', async () => {
    const resultado = await autorizarRevisionDocumentalExterna(
      solicitudBase
    );

    expect(resultado.mandanteEmpresaId).toBe(1);

    expect(obtenerEmpresaAdministrador)
      .toHaveBeenCalledWith(2, {});

    expect(AcreditacionDocumentalExterna.findByPk)
      .toHaveBeenCalledWith(
        100,
        {
          attributes: ['id', 'contrato_id'],
        }
      );

    expect(ContratoExterno.findByPk)
      .toHaveBeenCalledWith(
        50,
        {
          attributes: ['id', 'mandante_empresa_id'],
        }
      );

    expect(Empresa.findByPk)
      .toHaveBeenCalledWith(
        1,
        {
          attributes: ['id', 'activo'],
        }
      );
  });
});
