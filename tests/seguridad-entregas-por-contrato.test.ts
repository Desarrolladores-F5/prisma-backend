// tests/seguridad-entregas-por-contrato.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryTypes } from 'sequelize';

vi.mock('../src/models', () => ({
  sequelize: {
    query: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
}));

import { sequelize } from '../src/models';

import {
  obtenerEmpresaAdministrador,
} from '../src/services/asignacionDocumental.service';

import {
  obtenerEntregasPorResolverContrato,
} from '../src/services/entregasPorResolverContrato.service';

describe('Seguridad - entregas por resolver por contrato', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValue(1);
    vi.mocked(sequelize.query).mockResolvedValue([] as never);
  });

  it('consulta exclusivamente la mandante del administrador', async () => {
    await obtenerEntregasPorResolverContrato(10);

    expect(obtenerEmpresaAdministrador)
      .toHaveBeenCalledWith(10);

    expect(sequelize.query).toHaveBeenCalledOnce();

    const [sql, opciones] =
      vi.mocked(sequelize.query).mock.calls[0];

    expect(sql).toContain(
      'WHERE c.mandante_empresa_id = :mandanteId'
    );

    expect(sql).toContain(
      "a.estado IN ('pendiente', 'en_revision')"
    );

    expect(sql).toContain(
      "r.activo = 1 AND r.destinatario = 'empresa'"
    );

    expect(sql).toContain(
      'ultima.contrato_trabajador_id IS NULL'
    );

    expect(sql).toContain('GROUP BY c.id');

    expect(opciones).toMatchObject({
      replacements: { mandanteId: 1 },
      type: QueryTypes.SELECT,
    });
  });

  it('devuelve los totales asociados a cada contrato', async () => {
    vi.mocked(sequelize.query).mockResolvedValueOnce([
      { contrato_id: 50, total: 3 },
      { contrato_id: 51, total: 2 },
    ] as never);

    const resultado =
      await obtenerEntregasPorResolverContrato(10);

    expect(resultado).toEqual([
      { contrato_id: 50, total: 3 },
      { contrato_id: 51, total: 2 },
    ]);

    expect(
      resultado.reduce((suma, contrato) => suma + contrato.total, 0)
    ).toBe(5);
  });

  it('devuelve un listado vacío cuando no hay entregas por resolver', async () => {
    const resultado =
      await obtenerEntregasPorResolverContrato(10);

    expect(resultado).toEqual([]);
  });

  it('rechaza identificadores inválidos', async () => {
    await expect(
      obtenerEntregasPorResolverContrato(-1)
    ).rejects.toThrow('Administrador inválido.');

    expect(obtenerEmpresaAdministrador)
      .not.toHaveBeenCalled();

    expect(sequelize.query)
      .not.toHaveBeenCalled();
  });

  it('no consulta entregas cuando falla la autorización', async () => {
    vi.mocked(obtenerEmpresaAdministrador)
      .mockRejectedValueOnce(
        new Error('Administrador no autorizado')
      );

    await expect(
      obtenerEntregasPorResolverContrato(10)
    ).rejects.toThrow('Administrador no autorizado');

    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('rechaza resultados con identificadores o totales inválidos', async () => {
    vi.mocked(sequelize.query).mockResolvedValueOnce([
      { contrato_id: 50, total: -1 },
    ] as never);

    await expect(
      obtenerEntregasPorResolverContrato(10)
    ).rejects.toThrow('valores inválidos');
  });
});
