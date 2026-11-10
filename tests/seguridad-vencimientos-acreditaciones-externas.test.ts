import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Op } from 'sequelize';

vi.mock('../src/models', () => ({
  sequelize: {
    transaction: vi.fn(),
  },
  AcreditacionDocumentalExterna: {
    update: vi.fn(),
  },
}));

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../src/models';

import {
  marcarAcreditacionExternaVencida,
} from '../src/services/vencimientosAcreditacionesExternas.service';

describe('Seguridad de vencimientos de acreditaciones externas', () => {
  const transaccion = {
    id: 'transaccion-vencimiento-prueba',
  } as any;

  const instante = new Date(
    '2026-11-10T15:00:00.000Z'
  );

  const solicitudBase = {
    acreditacionId: 100,
    instante,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(sequelize.transaction).mockImplementation(
      (async (callback: any) => {
        return callback(transaccion);
      }) as any
    );

    vi.mocked(
      AcreditacionDocumentalExterna.update
    ).mockResolvedValue([1] as any);
  });

  it('marca como vencida una acreditación aprobada', async () => {
    const resultado =
      await marcarAcreditacionExternaVencida(
        solicitudBase
      );

    expect(resultado).toEqual({
      acreditacionId: 100,
      fechaActual: '2026-11-10',
      actualizada: true,
    });

    expect(
      AcreditacionDocumentalExterna.update
    ).toHaveBeenCalledTimes(1);
  });

  it('utiliza una actualización condicional segura', async () => {
    await marcarAcreditacionExternaVencida(
      solicitudBase
    );

    expect(
      AcreditacionDocumentalExterna.update
    ).toHaveBeenCalledWith(
      {
        estado: 'vencido',
      },
      {
        where: {
          id: 100,
          estado: 'aprobado',
          fecha_vencimiento: {
            [Op.lt]: '2026-11-10',
          },
        },
        transaction: transaccion,
      }
    );
  });

  it('no modifica el historial de revisión', async () => {
    await marcarAcreditacionExternaVencida(
      solicitudBase
    );

    const cambios = vi.mocked(
      AcreditacionDocumentalExterna.update
    ).mock.calls[0][0] as Record<string, unknown>;

    expect(Object.keys(cambios)).toEqual([
      'estado',
    ]);

    expect(cambios).not.toHaveProperty(
      'revisado_por'
    );

    expect(cambios).not.toHaveProperty(
      'fecha_revision'
    );

    expect(cambios).not.toHaveProperty(
      'observaciones'
    );

    expect(cambios).not.toHaveProperty(
      'fecha_vencimiento'
    );
  });

  it('informa cuando no existe ninguna transición', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.update
    ).mockResolvedValue([0] as any);

    const resultado =
      await marcarAcreditacionExternaVencida(
        solicitudBase
      );

    expect(resultado.actualizada).toBe(false);
  });

  it('permite ejecuciones repetidas sin exigir una nueva transición', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.update
    )
      .mockResolvedValueOnce([1] as any)
      .mockResolvedValueOnce([0] as any);

    const primera =
      await marcarAcreditacionExternaVencida(
        solicitudBase
      );

    const segunda =
      await marcarAcreditacionExternaVencida(
        solicitudBase
      );

    expect(primera.actualizada).toBe(true);
    expect(segunda.actualizada).toBe(false);

    expect(
      AcreditacionDocumentalExterna.update
    ).toHaveBeenCalledTimes(2);
  });

  it('respeta una transacción externa', async () => {
    const resultado =
      await marcarAcreditacionExternaVencida({
        ...solicitudBase,
        transaction: transaccion,
      });

    expect(resultado.actualizada).toBe(true);

    expect(
      sequelize.transaction
    ).not.toHaveBeenCalled();

    expect(
      AcreditacionDocumentalExterna.update
    ).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        transaction: transaccion,
      })
    );
  });

  it('crea una transacción propia si no recibe una externa', async () => {
    await marcarAcreditacionExternaVencida(
      solicitudBase
    );

    expect(
      sequelize.transaction
    ).toHaveBeenCalledTimes(1);

    expect(
      AcreditacionDocumentalExterna.update
    ).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        transaction: transaccion,
      })
    );
  });

  it('rechaza identificadores inválidos sin escribir', async () => {
    for (const acreditacionId of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      await expect(
        marcarAcreditacionExternaVencida({
          acreditacionId,
          instante,
        })
      ).rejects.toThrow(
        'Identificador de acreditación inválido.'
      );
    }

    expect(
      AcreditacionDocumentalExterna.update
    ).not.toHaveBeenCalled();

    expect(
      sequelize.transaction
    ).not.toHaveBeenCalled();
  });

  it('rechaza fechas inválidas sin escribir', async () => {
    await expect(
      marcarAcreditacionExternaVencida({
        acreditacionId: 100,
        instante: new Date('fecha-invalida'),
      })
    ).rejects.toThrow(
      'Instante de referencia inválido.'
    );

    expect(
      AcreditacionDocumentalExterna.update
    ).not.toHaveBeenCalled();
  });

  it('rechaza modificaciones múltiples inesperadas', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.update
    ).mockResolvedValue([2] as any);

    await expect(
      marcarAcreditacionExternaVencida(
        solicitudBase
      )
    ).rejects.toThrow(
      'Se modificaron más acreditaciones de las permitidas.'
    );
  });

  it('propaga errores de MySQL para permitir rollback', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.update
    ).mockRejectedValue(
      new Error('Error simulado de MySQL')
    );

    await expect(
      marcarAcreditacionExternaVencida(
        solicitudBase
      )
    ).rejects.toThrow(
      'Error simulado de MySQL'
    );
  });

  it('utiliza la fecha de Chile cerca de medianoche UTC', async () => {
    await marcarAcreditacionExternaVencida({
      acreditacionId: 100,
      instante: new Date(
        '2026-11-11T01:30:00.000Z'
      ),
    });

    expect(
      AcreditacionDocumentalExterna.update
    ).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        where: expect.objectContaining({
          fecha_vencimiento: {
            [Op.lt]: '2026-11-10',
          },
        }),
      })
    );
  });
});
