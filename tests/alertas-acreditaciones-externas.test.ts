// tests/alertas-acreditaciones-externas.test.ts

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Op } from 'sequelize';

vi.mock('../src/models', () => ({
  AcreditacionDocumentalExterna: {
    findByPk: vi.fn(),
  },
  ContratoExterno: {
    findByPk: vi.fn(),
  },
  Faena: {
    findByPk: vi.fn(),
  },
  UsuarioEmpresaExterna: {
    findAll: vi.fn(),
  },
  Usuario: {
    findAll: vi.fn(),
  },
}));

vi.mock(
  '../src/services/notificacionesAutomaticas.service',
  () => ({
    crearNotificacionesAutomaticas: vi.fn(),
  })
);

import {
  AcreditacionDocumentalExterna,
  ContratoExterno,
  Faena,
  Usuario,
  UsuarioEmpresaExterna,
} from '../src/models';

import {
  crearNotificacionesAutomaticas,
} from '../src/services/notificacionesAutomaticas.service';

import {
  generarAlertasAcreditacionExterna,
} from '../src/services/alertasAcreditacionesExternas.service';

describe('Seguridad de alertas documentales externas', () => {
  const instante = new Date(
    '2026-11-10T15:00:00.000Z'
  );

  const acreditacion = {
    id: 100,
    contrato_id: 50,
    estado: 'aprobado',
    fecha_vencimiento: '2026-11-20',
  };

  const contrato = {
    id: 50,
    mandante_empresa_id: 1,
    contratista_empresa_id: 3,
    faena_id: 7,
    nombre: 'Contrato externo de prueba',
    estado: 'activo',
  };

  const faena = {
    get: vi.fn().mockReturnValue(1),
  };

  const ejecutar = () =>
    generarAlertasAcreditacionExterna({
      acreditacionId: 100,
      instante,
    });

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(
      AcreditacionDocumentalExterna.findByPk
    ).mockResolvedValue({
      ...acreditacion,
    } as any);

    vi.mocked(
      ContratoExterno.findByPk
    ).mockResolvedValue({
      ...contrato,
    } as any);

    vi.mocked(
      Faena.findByPk
    ).mockResolvedValue({
      get: vi.fn().mockReturnValue(1),
    } as any);

    vi.mocked(
      UsuarioEmpresaExterna.findAll
    ).mockResolvedValue([
      {
        usuario_id: 20,
      },
      {
        usuario_id: 21,
      },
    ] as any);

    vi.mocked(
      Usuario.findAll
    ).mockResolvedValue([
      { id: 20 },
      { id: 21 },
    ] as any);

    vi.mocked(
      crearNotificacionesAutomaticas
    ).mockResolvedValue(2);
  });

  it('genera avisos separados para mandante y contratista', async () => {
    const resultado = await ejecutar();

    expect(resultado).toEqual({
      acreditacionId: 100,
      clasificacion: 'proximo_a_vencer',
      notificacionesMandante: 2,
      notificacionesContratista: 2,
      totalNotificaciones: 4,
    });

    expect(
      crearNotificacionesAutomaticas
    ).toHaveBeenCalledTimes(2);
  });

  it('notifica al mandante mediante su faena', async () => {
    await ejecutar();

    expect(
      crearNotificacionesAutomaticas
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        origen: 'acreditaciones_externas',
        roles: [1],
        faenaId: 7,
        claveEvento:
          'alerta_vencimiento_externo:proximo:100:mandante',
      })
    );
  });

  it('notifica solamente a usuarios externos autorizados', async () => {
    await ejecutar();

    expect(
      UsuarioEmpresaExterna.findAll
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          empresa_id: 3,
          perfil: 'administrador_externo',
          activo: true,
        },
      })
    );

    expect(
      Usuario.findAll
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            [Op.in]: [20, 21],
          },
          activo: true,
        },
      })
    );

    expect(
      crearNotificacionesAutomaticas
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        destinatariosIds: [20, 21],
        claveEvento:
          'alerta_vencimiento_externo:proximo:100:contratista',
      })
    );
  });

  it('no envía avisos si la faena pertenece a otra empresa', async () => {
    vi.mocked(
      Faena.findByPk
    ).mockResolvedValue({
      get: vi.fn().mockReturnValue(999),
    } as any);

    await expect(
      ejecutar()
    ).rejects.toThrow(
      'La faena no pertenece a la empresa mandante del contrato.'
    );

    expect(
      crearNotificacionesAutomaticas
    ).not.toHaveBeenCalled();
  });

  it('no envía avisos si falta la faena', async () => {
    vi.mocked(
      Faena.findByPk
    ).mockResolvedValue(null);

    await expect(
      ejecutar()
    ).rejects.toThrow(
      'La faena no pertenece a la empresa mandante del contrato.'
    );

    expect(
      crearNotificacionesAutomaticas
    ).not.toHaveBeenCalled();
  });

  it('excluye usuarios externos cuyas cuentas están inactivas', async () => {
    // La consulta a Usuario solamente devuelve
    // cuentas activas. El usuario 21 queda excluido.
    vi.mocked(
      Usuario.findAll
    ).mockResolvedValue([
      { id: 20 },
    ] as any);

    await ejecutar();

    expect(
      crearNotificacionesAutomaticas
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        destinatariosIds: [20],
      })
    );
  });

  it('no genera alertas para acreditaciones pendientes', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.findByPk
    ).mockResolvedValue({
      ...acreditacion,
      estado: 'pendiente',
    } as any);

    const resultado = await ejecutar();

    expect(resultado.clasificacion).toBe('no_aplica');
    expect(resultado.totalNotificaciones).toBe(0);

    expect(
      crearNotificacionesAutomaticas
    ).not.toHaveBeenCalled();
  });

  it('no genera alertas para acreditaciones rechazadas', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.findByPk
    ).mockResolvedValue({
      ...acreditacion,
      estado: 'rechazado',
    } as any);

    const resultado = await ejecutar();

    expect(resultado.clasificacion).toBe('no_aplica');
    expect(resultado.totalNotificaciones).toBe(0);

    expect(
      crearNotificacionesAutomaticas
    ).not.toHaveBeenCalled();
  });

  it('no genera alertas para documentos aún vigentes', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.findByPk
    ).mockResolvedValue({
      ...acreditacion,
      fecha_vencimiento: '2027-01-20',
    } as any);

    const resultado = await ejecutar();

    expect(resultado.clasificacion).toBe('vigente');
    expect(resultado.totalNotificaciones).toBe(0);

    expect(
      crearNotificacionesAutomaticas
    ).not.toHaveBeenCalled();
  });

  it('identifica las alertas de documentos vencidos', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.findByPk
    ).mockResolvedValue({
      ...acreditacion,
      estado: 'vencido',
      fecha_vencimiento: '2026-11-09',
    } as any);

    const resultado = await ejecutar();

    expect(resultado.clasificacion).toBe('vencido');

    expect(
      crearNotificacionesAutomaticas
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'alerta_vencimiento_externo_vencido',
        claveEvento:
          'alerta_vencimiento_externo:vencido:100:mandante',
      })
    );
  });

  it('no genera avisos para contratos inactivos', async () => {
    vi.mocked(
      ContratoExterno.findByPk
    ).mockResolvedValue({
      ...contrato,
      estado: 'finalizado',
    } as any);

    const resultado = await ejecutar();

    expect(resultado.totalNotificaciones).toBe(0);

    expect(
      crearNotificacionesAutomaticas
    ).not.toHaveBeenCalled();
  });

  it('no notifica a contratistas sin administradores activos', async () => {
    vi.mocked(
      UsuarioEmpresaExterna.findAll
    ).mockResolvedValue([] as any);

    const resultado = await ejecutar();

    expect(resultado.notificacionesContratista).toBe(0);

    expect(
      crearNotificacionesAutomaticas
    ).toHaveBeenCalledTimes(1);

    expect(
      Usuario.findAll
    ).not.toHaveBeenCalled();
  });

  it('utiliza claves estables en ejecuciones repetidas', async () => {
    await ejecutar();
    await ejecutar();

    const llamadas = vi.mocked(
      crearNotificacionesAutomaticas
    ).mock.calls;

    expect(llamadas[0][0].claveEvento)
      .toBe(llamadas[2][0].claveEvento);

    expect(llamadas[1][0].claveEvento)
      .toBe(llamadas[3][0].claveEvento);
  });

  it('rechaza identificadores inválidos antes de consultar', async () => {
    await expect(
      generarAlertasAcreditacionExterna({
        acreditacionId: -1,
        instante,
      })
    ).rejects.toThrow(
      'Identificador de acreditación inválido.'
    );

    expect(
      AcreditacionDocumentalExterna.findByPk
    ).not.toHaveBeenCalled();
  });

  it('rechaza plazos de aviso inválidos', async () => {
    await expect(
      generarAlertasAcreditacionExterna({
        acreditacionId: 100,
        instante,
        diasAviso: 500,
      })
    ).rejects.toThrow(
      'El plazo de aviso debe estar entre 0 y 365 días.'
    );

    expect(
      AcreditacionDocumentalExterna.findByPk
    ).not.toHaveBeenCalled();
  });

  it('rechaza acreditaciones inexistentes', async () => {
    vi.mocked(
      AcreditacionDocumentalExterna.findByPk
    ).mockResolvedValue(null);

    await expect(
      ejecutar()
    ).rejects.toThrow(
      'La acreditación documental no existe.'
    );

    expect(
      crearNotificacionesAutomaticas
    ).not.toHaveBeenCalled();
  });
});
