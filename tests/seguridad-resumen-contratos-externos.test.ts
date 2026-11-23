// tests/seguridad-resumen-contratos-externos.test.ts

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
  obtenerResumenContratosExternos,
  ErrorResumenContratosExternos,
} from '../src/services/resumenContratosExternos.service';

const registro = (datos: Record<string, unknown>) => ({
  get: vi.fn().mockReturnValue(datos),
});

describe('Seguridad multiempresa - resumen de contratos externos', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValue(1);
    vi.mocked(ContratoExterno.findAll).mockResolvedValue([]);
  });

  it('consulta contratos únicamente de la mandante autenticada', async () => {
    await obtenerResumenContratosExternos({
      administradorId: 10,
    });

    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(10);

    expect(ContratoExterno.findAll).toHaveBeenCalledWith({
      where: {
        mandante_empresa_id: 1,
      },
      include: [
        {
          association: 'contratista',
          attributes: ['id', 'nombre', 'rut'],
          required: true,
        },
        {
          association: 'faena',
          attributes: ['id', 'nombre'],
          required: true,
          where: {
            empresa_id: 1,
          },
        },
        {
          association: 'contrato_principal',
          attributes: [
            'id',
            'nombre',
            'faena_id',
            'contratista_empresa_id',
          ],
          required: false,
          where: {
            mandante_empresa_id: 1,
          },
        },
      ],
      order: [['id', 'DESC']],
    });
  });

  it('identifica correctamente contratistas y subcontratistas', async () => {
    vi.mocked(ContratoExterno.findAll).mockResolvedValueOnce([
      registro({
        id: 50,
        nombre: 'Contrato principal',
        numero_contrato: 'CT-050',
        estado: 'activo',
        contratista_empresa_id: 2,
        faena_id: 8,
        contrato_principal_id: null,
        contratista: {
          id: 2,
          nombre: 'Constructora Ejemplo',
          rut: '76000000-0',
        },
        faena: {
          id: 8,
          nombre: 'Faena Norte',
        },
        contrato_principal: null,
      }),
      registro({
        id: 51,
        nombre: 'Subcontrato',
        numero_contrato: 'SC-051',
        estado: 'activo',
        contratista_empresa_id: 3,
        faena_id: 8,
        contrato_principal_id: 50,
        contratista: {
          id: 3,
          nombre: 'Servicios del Sur',
          rut: '77000000-0',
        },
        faena: {
          id: 8,
          nombre: 'Faena Norte',
        },
        contrato_principal: {
          id: 50,
          nombre: 'Contrato principal',
          faena_id: 8,
          contratista_empresa_id: 2,
        },
      }),
    ] as never);

    const resultado = await obtenerResumenContratosExternos({
      administradorId: 10,
    });

    expect(resultado).toHaveLength(2);

    expect(resultado[0]).toMatchObject({
      id: 50,
      tipo: 'contratista',
      contratista: {
        nombre: 'Constructora Ejemplo',
      },
    });

    expect(resultado[1]).toMatchObject({
      id: 51,
      tipo: 'subcontratista',
      contrato_principal_id: 50,
      contratista: {
        nombre: 'Servicios del Sur',
      },
    });
  });

  it('no presenta contratos con relaciones incompletas', async () => {
    vi.mocked(ContratoExterno.findAll).mockResolvedValueOnce([
      registro({
        id: 60,
        contrato_principal_id: null,
        contratista: null,
        faena: { id: 8, nombre: 'Faena Norte' },
      }),
      registro({
        id: 61,
        contrato_principal_id: null,
        contratista: {
          id: 2,
          nombre: 'Constructora Ejemplo',
        },
        faena: null,
      }),
      registro({
        id: 62,
        contrato_principal_id: 999,
        contratista: {
          id: 2,
          nombre: 'Constructora Ejemplo',
        },
        faena: { id: 8, nombre: 'Faena Norte' },
        contrato_principal: null,
      }),
    ] as never);

    const resultado = await obtenerResumenContratosExternos({
      administradorId: 10,
    });

    expect(resultado).toEqual([]);
  });

  it('rechaza identificadores de administrador inválidos', async () => {
    await expect(
      obtenerResumenContratosExternos({
        administradorId: -1,
      })
    ).rejects.toBeInstanceOf(ErrorResumenContratosExternos);

    expect(obtenerEmpresaAdministrador).not.toHaveBeenCalled();
    expect(ContratoExterno.findAll).not.toHaveBeenCalled();
  });

  it('no consulta contratos si falla la autorización empresarial', async () => {
    vi.mocked(obtenerEmpresaAdministrador).mockRejectedValueOnce(
      new Error('Administrador no autorizado')
    );

    await expect(
      obtenerResumenContratosExternos({
        administradorId: 10,
      })
    ).rejects.toThrow('Administrador no autorizado');

    expect(ContratoExterno.findAll).not.toHaveBeenCalled();
  });

  it('propaga la transacción a la autorización y consulta', async () => {
    const transaction = {
      id: 'transaccion-prueba',
    } as never;

    await obtenerResumenContratosExternos({
      administradorId: 10,
      transaction,
    });

    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(
      10,
      { transaction }
    );

    expect(ContratoExterno.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          mandante_empresa_id: 1,
        },
        transaction,
      })
    );
  });

  it('excluye subcontratos asociados a otra faena', async () => {
    vi.mocked(ContratoExterno.findAll).mockResolvedValueOnce([
      registro({
        id: 70,
        nombre: 'Subcontrato inconsistente',
        contrato_principal_id: 50,
        contratista_empresa_id: 3,
        faena_id: 8,
        contratista: { id: 3, nombre: 'Servicios del Sur', rut: null },
        faena: { id: 8, nombre: 'Faena Norte' },
        contrato_principal: {
          id: 50,
          nombre: 'Contrato principal',
          faena_id: 9,
          contratista_empresa_id: 2,
        },
      }),
    ] as never);

    const resultado = await obtenerResumenContratosExternos({
      administradorId: 10,
    });

    expect(resultado).toEqual([]);
  });

  it('excluye subcontratos de la misma empresa contratista principal', async () => {
    vi.mocked(ContratoExterno.findAll).mockResolvedValueOnce([
      registro({
        id: 71,
        nombre: 'Subcontrato inconsistente',
        contrato_principal_id: 50,
        contratista_empresa_id: 2,
        faena_id: 8,
        contratista: { id: 2, nombre: 'Constructora Ejemplo', rut: null },
        faena: { id: 8, nombre: 'Faena Norte' },
        contrato_principal: {
          id: 50,
          nombre: 'Contrato principal',
          faena_id: 8,
          contratista_empresa_id: 2,
        },
      }),
    ] as never);

    const resultado = await obtenerResumenContratosExternos({
      administradorId: 10,
    });

    expect(resultado).toEqual([]);
  });

});
