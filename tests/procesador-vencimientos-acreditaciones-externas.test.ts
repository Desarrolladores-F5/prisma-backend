// tests/procesador-vencimientos-acreditaciones-externas.test.ts

import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Op } from 'sequelize';

vi.mock('../src/models', () => ({
  sequelize: {
    query: vi.fn(),
    transaction: vi.fn(),
  },
  AcreditacionDocumentalExterna: {
    findAll: vi.fn(),
  },
}));

vi.mock(
  '../src/services/vencimientosAcreditacionesExternas.service',
  async importOriginal => {
    const original = await importOriginal<
      typeof import(
        '../src/services/vencimientosAcreditacionesExternas.service'
      )
    >();

    return {
      obtenerFechaActualChile:
        original.obtenerFechaActualChile,
      clasificarVigenciaAcreditacionExterna:
        original.clasificarVigenciaAcreditacionExterna,
      marcarAcreditacionExternaVencida: vi.fn(),
    };
  }
);

vi.mock(
  '../src/services/alertasAcreditacionesExternas.service',
  () => ({
    generarAlertasAcreditacionExterna: vi.fn(),
  })
);

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../src/models';

import {
  marcarAcreditacionExternaVencida,
} from '../src/services/vencimientosAcreditacionesExternas.service';

import {
  generarAlertasAcreditacionExterna,
} from '../src/services/alertasAcreditacionesExternas.service';

import {
  procesarVencimientosAcreditacionesExternas,
} from '../src/services/procesadorVencimientosAcreditacionesExternas.service';

describe('Procesador por lotes de acreditaciones externas', () => {
  const instante = new Date(
    '2026-11-10T15:00:00.000Z'
  );

  const transaction = {
    id: 'transaccion-ficticia',
  } as any;

  const vencida = {
    id: 10,
    estado: 'aprobado',
    fecha_vencimiento: '2026-11-09',
  };

  const proxima = {
    id: 20,
    estado: 'aprobado',
    fecha_vencimiento: '2026-11-20',
  };

  const yaVencida = {
    id: 30,
    estado: 'vencido',
    fecha_vencimiento: '2026-11-01',
  };

  const ejecutar = (
    opciones: Record<string, unknown> = {}
  ) =>
    procesarVencimientosAcreditacionesExternas({
      instante,
      ...opciones,
    });

  beforeEach(() => {
    vi.resetAllMocks();

    vi.stubEnv(
      'DB_NAME',
      'prisma_test_empresas_externas'
    );

    vi.stubEnv('DB_HOST', '127.0.0.1');

    vi.mocked(
      sequelize.query
    ).mockResolvedValue([
      {
        nombre: 'prisma_test_empresas_externas',
      },
    ] as any);

    vi.mocked(
      sequelize.transaction
    ).mockImplementation(
      (async (callback: any) =>
        callback(transaction)) as any
    );

    vi.mocked(
      AcreditacionDocumentalExterna.findAll
    )
      .mockResolvedValueOnce([
        vencida,
        proxima,
        yaVencida,
      ] as any)
      .mockResolvedValue([] as any);

    vi.mocked(
      marcarAcreditacionExternaVencida
    ).mockImplementation(
      async ({ acreditacionId }) => ({
        acreditacionId,
        fechaActual: '2026-11-10',
        actualizada: acreditacionId === 10,
      })
    );

    vi.mocked(
      generarAlertasAcreditacionExterna
    ).mockImplementation(
      async ({ acreditacionId }) => ({
        acreditacionId,
        clasificacion:
          acreditacionId === 20
            ? 'proximo_a_vencer'
            : 'vencido',
        notificacionesMandante: 1,
        notificacionesContratista: 1,
        totalNotificaciones: 2,
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('utiliza simulación por defecto sin escrituras', async () => {
    const resultado = await ejecutar();

    expect(resultado.modo).toBe('simulacion');
    expect(resultado.examinadas).toBe(3);
    expect(resultado.vencimientosDetectados).toBe(2);
    expect(resultado.proximasAVencer).toBe(1);

    expect(
      marcarAcreditacionExternaVencida
    ).not.toHaveBeenCalled();

    expect(
      generarAlertasAcreditacionExterna
    ).not.toHaveBeenCalled();

    expect(
      sequelize.transaction
    ).not.toHaveBeenCalled();

    expect(
      sequelize.query
    ).not.toHaveBeenCalled();
  });

  it('calcula las fechas usando el calendario de Chile', async () => {
    const resultado = await ejecutar();

    expect(resultado.fechaActual).toBe(
      '2026-11-10'
    );

    expect(resultado.fechaLimiteAviso).toBe(
      '2026-12-10'
    );
  });

  it('consulta solamente acreditaciones candidatas', async () => {
    await ejecutar();

    const consulta = vi.mocked(
      AcreditacionDocumentalExterna.findAll
    ).mock.calls[0][0] as any;

    expect(consulta.order).toEqual([
      ['id', 'ASC'],
    ]);

    expect(consulta.limit).toBe(100);

    expect(consulta.where.id[Op.gt]).toBe(0);

    expect(
      consulta.where[Op.or]
    ).toEqual([
      {
        estado: 'aprobado',
        fecha_vencimiento: {
          [Op.lte]: '2026-12-10',
        },
      },
      {
        estado: 'vencido',
        fecha_vencimiento: {
          [Op.lte]: '2026-11-10',
        },
      },
    ]);
  });

  it('bloquea escrituras en la base principal de PRISMA', async () => {
    vi.stubEnv('DB_NAME', 'Prisma');

    await expect(
      ejecutar({
        modo: 'escritura',
      })
    ).rejects.toThrow('BLOQUEADO');

    expect(
      AcreditacionDocumentalExterna.findAll
    ).not.toHaveBeenCalled();

    expect(
      marcarAcreditacionExternaVencida
    ).not.toHaveBeenCalled();
  });

  it('comprueba la base efectivamente conectada', async () => {
    vi.mocked(
      sequelize.query
    ).mockResolvedValue([
      {
        nombre: 'otra_base',
      },
    ] as any);

    await expect(
      ejecutar({
        modo: 'escritura',
      })
    ).rejects.toThrow('BLOQUEADO');

    expect(
      marcarAcreditacionExternaVencida
    ).not.toHaveBeenCalled();
  });

  it('actualiza estados y genera alertas en transacciones', async () => {
    const resultado = await ejecutar({
      modo: 'escritura',
    });

    expect(resultado.examinadas).toBe(3);
    expect(resultado.estadosActualizados).toBe(1);

    expect(resultado.notificacionesMandante).toBe(3);
    expect(resultado.notificacionesContratista).toBe(3);
    expect(resultado.notificacionesTotales).toBe(6);

    expect(
      sequelize.transaction
    ).toHaveBeenCalledTimes(3);

    expect(
      marcarAcreditacionExternaVencida
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        acreditacionId: 10,
        transaction,
      })
    );

    expect(
      generarAlertasAcreditacionExterna
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        acreditacionId: 10,
        transaction,
      })
    );
  });

  it('reintenta alertas de acreditaciones ya vencidas', async () => {
    await ejecutar({
      modo: 'escritura',
    });

    expect(
      generarAlertasAcreditacionExterna
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        acreditacionId: 30,
        transaction,
      })
    );
  });

  it('continúa con otros documentos si uno falla', async () => {
    vi.mocked(
      generarAlertasAcreditacionExterna
    ).mockImplementation(
      async ({ acreditacionId }) => {
        if (acreditacionId === 10) {
          throw new Error(
            'Fallo simulado de notificación'
          );
        }

        return {
          acreditacionId,
          clasificacion: 'proximo_a_vencer',
          notificacionesMandante: 1,
          notificacionesContratista: 1,
          totalNotificaciones: 2,
        };
      }
    );

    const resultado = await ejecutar({
      modo: 'escritura',
    });

    expect(resultado.examinadas).toBe(3);
    expect(resultado.estadosActualizados).toBe(0);
    expect(resultado.notificacionesTotales).toBe(4);

    expect(resultado.errores).toEqual([
      {
        acreditacionId: 10,
        mensaje: 'Fallo simulado de notificación',
      },
    ]);

    expect(
      generarAlertasAcreditacionExterna
    ).toHaveBeenCalledTimes(3);
  });

  it('respeta el tamaño de lote y el máximo de registros', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.findAll
    )
      .mockReset()
      .mockResolvedValueOnce([
        vencida,
      ] as any)
      .mockResolvedValueOnce([
        proxima,
      ] as any)
      .mockResolvedValueOnce([
        yaVencida,
      ] as any);

    const resultado = await ejecutar({
      tamanoLote: 1,
      maximoRegistros: 2,
    });

    expect(resultado.examinadas).toBe(2);
    expect(resultado.limiteAlcanzado).toBe(true);

    expect(
      AcreditacionDocumentalExterna.findAll
    ).toHaveBeenCalledTimes(2);

    const segundaConsulta = vi.mocked(
      AcreditacionDocumentalExterna.findAll
    ).mock.calls[1][0] as any;

    expect(
      segundaConsulta.where.id[Op.gt]
    ).toBe(10);
  });

  it('rechaza parámetros inválidos antes de consultar MySQL', async () => {
    await expect(
      ejecutar({
        tamanoLote: 0,
      })
    ).rejects.toThrow(
      'Parámetros de procesamiento fuera de rango.'
    );

    await expect(
      ejecutar({
        maximoRegistros: 6000,
      })
    ).rejects.toThrow(
      'Parámetros de procesamiento fuera de rango.'
    );

    expect(
      AcreditacionDocumentalExterna.findAll
    ).not.toHaveBeenCalled();
  });
});
