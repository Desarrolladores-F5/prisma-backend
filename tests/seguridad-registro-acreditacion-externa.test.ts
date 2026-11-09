import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  sequelize: {
    transaction: vi.fn(),
  },
  AcreditacionDocumentalExterna: {
    create: vi.fn(),
  },
}));

vi.mock(
  '../src/services/autorizacionPresentacionDocumentalExterna.service',
  () => ({
    autorizarPresentacionDocumentalExterna: vi.fn(),
  })
);

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../src/models';

import {
  autorizarPresentacionDocumentalExterna,
} from '../src/services/autorizacionPresentacionDocumentalExterna.service';

import {
  registrarAcreditacionDocumentalExterna,
  ErrorRegistroAcreditacionExterna,
} from '../src/services/registroAcreditacionDocumentalExterna.service';

describe('Seguridad del registro de acreditaciones externas', () => {
  const transaccion = { id: 'transaccion-prueba' } as any;

  const solicitudBase = {
    administradorId: 9,
    contratoId: 50,
    requisitoId: 100,
    documentoId: 200,
  };

  const autorizacionBase = {
    administradorId: 9,
    contratoId: 50,
    empresaId: 3,
    requisitoId: 100,
    documentoId: 200,
    contratoTrabajadorId: null,
    destinatario: 'empresa' as const,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(sequelize.transaction).mockImplementation(
      (async (callback: any) => {
        return callback(transaccion);
      }) as any
    );

    vi.mocked(autorizarPresentacionDocumentalExterna)
      .mockResolvedValue({ ...autorizacionBase });

    vi.mocked(AcreditacionDocumentalExterna.create)
      .mockImplementation(
        async (datos: any) => ({
          id: 300,
          ...datos,
        }) as any
      );
  });

  it('registra una acreditación pendiente', async () => {
    const resultado = await registrarAcreditacionDocumentalExterna(
      solicitudBase
    );

    expect(resultado.id).toBe(300);
    expect(resultado.estado).toBe('pendiente');
    expect(resultado.presentado_por).toBe(9);
    expect(resultado.revisado_por).toBeNull();
    expect(resultado.fecha_revision).toBeNull();
  });

  it('utiliza la identidad y el contrato autorizados', async () => {
    await registrarAcreditacionDocumentalExterna(solicitudBase);

    expect(AcreditacionDocumentalExterna.create)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          contrato_id: 50,
          requisito_id: 100,
          documento_id: 200,
          presentado_por: 9,
        }),
        { transaction: transaccion }
      );
  });

  it('no permite que campos adicionales alteren la aprobación', async () => {
    const solicitud = {
      ...solicitudBase,
      estado: 'aprobado',
      presentado_por: 999,
      revisado_por: 999,
    };

    await registrarAcreditacionDocumentalExterna(solicitud);

    expect(AcreditacionDocumentalExterna.create)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'pendiente',
          presentado_por: 9,
          revisado_por: null,
          fecha_revision: null,
        }),
        { transaction: transaccion }
      );
  });

  it('registra fechas válidas y coherentes', async () => {
    await registrarAcreditacionDocumentalExterna({
      ...solicitudBase,
      fechaEmision: '2026-11-08',
      fechaVencimiento: '2027-11-08',
      periodoInicio: '2026-11-01',
      periodoTermino: '2026-11-30',
    });

    expect(AcreditacionDocumentalExterna.create)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          fecha_emision: '2026-11-08',
          fecha_vencimiento: '2027-11-08',
          periodo_inicio: '2026-11-01',
          periodo_termino: '2026-11-30',
        }),
        expect.any(Object)
      );
  });

  it('rechaza fechas inexistentes', async () => {
    await expect(
      registrarAcreditacionDocumentalExterna({
        ...solicitudBase,
        fechaEmision: '2026-02-30',
      })
    ).rejects.toBeInstanceOf(ErrorRegistroAcreditacionExterna);

    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(AcreditacionDocumentalExterna.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza fechas con formato inválido', async () => {
    await expect(
      registrarAcreditacionDocumentalExterna({
        ...solicitudBase,
        periodoInicio: '08/11/2026',
      })
    ).rejects.toBeInstanceOf(ErrorRegistroAcreditacionExterna);

    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it('rechaza vencimientos anteriores a la emisión', async () => {
    await expect(
      registrarAcreditacionDocumentalExterna({
        ...solicitudBase,
        fechaEmision: '2026-12-01',
        fechaVencimiento: '2026-11-01',
      })
    ).rejects.toThrow(
      'Vigencia documental: la fecha de término no puede ser anterior al inicio.'
    );

    expect(AcreditacionDocumentalExterna.create)
      .not.toHaveBeenCalled();
  });

  it('rechaza períodos documentales invertidos', async () => {
    await expect(
      registrarAcreditacionDocumentalExterna({
        ...solicitudBase,
        periodoInicio: '2026-12-01',
        periodoTermino: '2026-11-01',
      })
    ).rejects.toThrow(
      'Período documental: la fecha de término no puede ser anterior al inicio.'
    );

    expect(AcreditacionDocumentalExterna.create)
      .not.toHaveBeenCalled();
  });

  it('mantiene autorización e inserción en la misma transacción', async () => {
    await registrarAcreditacionDocumentalExterna(solicitudBase);

    expect(autorizarPresentacionDocumentalExterna)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          administradorId: 9,
          contratoId: 50,
          requisitoId: 100,
          documentoId: 200,
          contratoTrabajadorId: null,
          transaction: transaccion,
        })
      );

    expect(AcreditacionDocumentalExterna.create)
      .toHaveBeenCalledWith(
        expect.any(Object),
        { transaction: transaccion }
      );
  });

  it('no inserta cuando falla la autorización', async () => {
    vi.mocked(autorizarPresentacionDocumentalExterna)
      .mockRejectedValue(new Error('Acceso denegado'));

    await expect(
      registrarAcreditacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow('Acceso denegado');

    expect(AcreditacionDocumentalExterna.create)
      .not.toHaveBeenCalled();
  });

  it('propaga un error de inserción dentro de la transacción', async () => {
    vi.mocked(AcreditacionDocumentalExterna.create)
      .mockRejectedValue(new Error('Error de base de datos'));

    await expect(
      registrarAcreditacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow('Error de base de datos');

    expect(sequelize.transaction).toHaveBeenCalledOnce();
  });

  it('conserva la vinculación del trabajador autorizado', async () => {
    vi.mocked(autorizarPresentacionDocumentalExterna)
      .mockResolvedValue({
        ...autorizacionBase,
        contratoTrabajadorId: 400,
        destinatario: 'trabajador',
      });

    await registrarAcreditacionDocumentalExterna({
      ...solicitudBase,
      contratoTrabajadorId: 400,
    });

    expect(AcreditacionDocumentalExterna.create)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          contrato_trabajador_id: 400,
          estado: 'pendiente',
        }),
        { transaction: transaccion }
      );
  });
});
