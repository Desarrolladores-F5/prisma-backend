// tests/seguridad-consulta-contratos-externos.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  ContratoExterno: {
    findAll: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
}));

import { ContratoExterno } from '../src/models';

import {
  obtenerEmpresaAdministrador,
} from '../src/services/asignacionDocumental.service';

import {
  obtenerContratosExternosMandante,
  ErrorConsultaContratosExternos,
} from '../src/services/consultaContratosExternos.service';

describe('Seguridad multiempresa - consulta de contratos externos', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValue(1);
    vi.mocked(ContratoExterno.findAll).mockResolvedValue([]);
  });

  it('consulta exclusivamente los contratos de la mandante', async () => {
    await obtenerContratosExternosMandante({
      administradorId: 10,
    });

    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(10);

    expect(ContratoExterno.findAll).toHaveBeenCalledWith({
      where: {
        mandante_empresa_id: 1,
      },
      order: [['id', 'DESC']],
    });
  });

  it('rechaza identificadores de administrador inválidos', async () => {
    await expect(
      obtenerContratosExternosMandante({
        administradorId: -1,
      })
    ).rejects.toBeInstanceOf(ErrorConsultaContratosExternos);

    expect(obtenerEmpresaAdministrador).not.toHaveBeenCalled();
    expect(ContratoExterno.findAll).not.toHaveBeenCalled();
  });

  it('no consulta contratos cuando falla la autorización', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockRejectedValueOnce(
      new Error('Administrador no autorizado')
    );

    await expect(
      obtenerContratosExternosMandante({
        administradorId: 10,
      })
    ).rejects.toThrow('Administrador no autorizado');

    expect(ContratoExterno.findAll).not.toHaveBeenCalled();
  });

  it('propaga la transacción a la autorización y consulta', async () => {
    const transaction = {
      id: 'transaccion-prueba',
    } as any;

    await obtenerContratosExternosMandante({
      administradorId: 10,
      transaction,
    });

    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(
      10,
      { transaction }
    );

    expect(ContratoExterno.findAll).toHaveBeenCalledWith({
      where: {
        mandante_empresa_id: 1,
      },
      order: [['id', 'DESC']],
      transaction,
    });
  });
});
