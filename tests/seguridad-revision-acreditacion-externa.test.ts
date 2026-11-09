import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('../src/models', () => ({
  sequelize: {
    transaction: vi.fn(),
  },
  AcreditacionDocumentalExterna: {
    findByPk: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock(
  '../src/services/autorizacionRevisionDocumentalExterna.service',
  () => ({
    autorizarRevisionDocumentalExterna: vi.fn(),
  })
);

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../src/models';

import {
  autorizarRevisionDocumentalExterna,
} from '../src/services/autorizacionRevisionDocumentalExterna.service';

import {
  revisarAcreditacionDocumentalExterna,
  ErrorRevisionAcreditacionExterna,
} from '../src/services/revisionAcreditacionDocumentalExterna.service';

describe('Seguridad de revisión de acreditaciones externas', () => {
  const transaccion = {
    id: 'transaccion-prueba',
  } as any;

  const solicitudBase = {
    administradorId: 2,
    acreditacionId: 100,
  };

  const autorizacionBase = {
    administradorId: 2,
    acreditacionId: 100,
    contratoId: 50,
    mandanteEmpresaId: 1,
  };

  const acreditacionBase = {
    id: 100,
    contrato_id: 50,
    estado: 'pendiente',
    revisado_por: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(sequelize.transaction).mockImplementation(
      (async (callback: any) => {
        return callback(transaccion);
      }) as any
    );

    vi.mocked(autorizarRevisionDocumentalExterna)
      .mockResolvedValue({
        ...autorizacionBase,
      });

    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        ...acreditacionBase,
      } as any);

    vi.mocked(AcreditacionDocumentalExterna.update)
      .mockResolvedValue([1] as any);
  });

  it('inicia una revisión pendiente', async () => {
    const resultado =
      await revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
      });

    expect(resultado.estado).toBe('en_revision');
    expect(resultado.revisadoPor).toBe(2);

    expect(AcreditacionDocumentalExterna.update)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'en_revision',
          revisado_por: 2,
        }),
        expect.objectContaining({
          where: {
            id: 100,
            contrato_id: 50,
            estado: 'pendiente',
            revisado_por: null,
          },
          transaction: transaccion,
        })
      );
  });

  it('rechaza iniciar una revisión ya iniciada', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        ...acreditacionBase,
        estado: 'en_revision',
        revisado_por: 2,
      } as any);

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
      })
    ).rejects.toThrow(
      'Solo una acreditación pendiente puede iniciar revisión.'
    );

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it('aprueba una acreditación en revisión', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        ...acreditacionBase,
        estado: 'en_revision',
        revisado_por: 2,
      } as any);

    const resultado =
      await revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'aprobar',
      });

    expect(resultado.estado).toBe('aprobado');
    expect(resultado.revisadoPor).toBe(2);

    expect(AcreditacionDocumentalExterna.update)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'aprobado',
          revisado_por: 2,
          fecha_revision: expect.any(Date),
        }),
        expect.objectContaining({
          where: {
            id: 100,
            contrato_id: 50,
            estado: 'en_revision',
            revisado_por: 2,
          },
        })
      );
  });

  it('rechaza una acreditación con observaciones', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        ...acreditacionBase,
        estado: 'en_revision',
        revisado_por: 2,
      } as any);

    const resultado =
      await revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'rechazar',
        observaciones: ' Documento ilegible ',
      });

    expect(resultado.estado).toBe('rechazado');
    expect(resultado.observaciones)
      .toBe('Documento ilegible');

    expect(AcreditacionDocumentalExterna.update)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          estado: 'rechazado',
          observaciones: 'Documento ilegible',
          fecha_revision: expect.any(Date),
        }),
        expect.any(Object)
      );
  });

  it('impide rechazar sin observaciones', async () => {
    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'rechazar',
      })
    ).rejects.toThrow(
      'El rechazo requiere observaciones.'
    );

    expect(sequelize.transaction)
      .not.toHaveBeenCalled();

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it('rechaza observaciones que superan el límite', async () => {
    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'rechazar',
        observaciones: 'A'.repeat(2001),
      })
    ).rejects.toBeInstanceOf(
      ErrorRevisionAcreditacionExterna
    );

    expect(sequelize.transaction)
      .not.toHaveBeenCalled();
  });

  it('rechaza observaciones que no son texto', async () => {
    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'rechazar',
        observaciones: 123 as any,
      })
    ).rejects.toThrow(
      'Las observaciones deben ser texto.'
    );

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it('rechaza acciones inválidas', async () => {
    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'eliminar' as any,
      })
    ).rejects.toThrow(
      'La acción de revisión documental es inválida.'
    );

    expect(sequelize.transaction)
      .not.toHaveBeenCalled();
  });

  it('impide aprobar sin iniciar revisión', async () => {
    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'aprobar',
      })
    ).rejects.toThrow(
      'La acreditación debe estar en revisión.'
    );

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it('impide finalizar la revisión de otro administrador', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        ...acreditacionBase,
        estado: 'en_revision',
        revisado_por: 9,
      } as any);

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'aprobar',
      })
    ).rejects.toThrow(
      'La revisión está asignada a otro administrador.'
    );

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it.each([
    'aprobado',
    'rechazado',
    'vencido',
  ])(
    'impide modificar una acreditación con estado %s',
    async (estado) => {
      vi.mocked(AcreditacionDocumentalExterna.findByPk)
        .mockResolvedValue({
          ...acreditacionBase,
          estado,
          revisado_por: 2,
        } as any);

      await expect(
        revisarAcreditacionDocumentalExterna({
          ...solicitudBase,
          accion: 'aprobar',
        })
      ).rejects.toThrow(
        'La acreditación debe estar en revisión.'
      );

      expect(AcreditacionDocumentalExterna.update)
        .not.toHaveBeenCalled();
    }
  );

  it('no actualiza cuando falla la autorización', async () => {
    vi.mocked(autorizarRevisionDocumentalExterna)
      .mockRejectedValue(
        new Error('Administrador sin autorización')
      );

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
      })
    ).rejects.toThrow(
      'Administrador sin autorización'
    );

    expect(AcreditacionDocumentalExterna.findByPk)
      .not.toHaveBeenCalled();

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it('rechaza acreditaciones inexistentes', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue(null);

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
      })
    ).rejects.toThrow(
      'Acreditación documental no encontrada.'
    );

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it('detecta cambios inesperados de contrato', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        ...acreditacionBase,
        contrato_id: 999,
      } as any);

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
      })
    ).rejects.toThrow(
      'La acreditación cambió durante la revisión.'
    );

    expect(AcreditacionDocumentalExterna.update)
      .not.toHaveBeenCalled();
  });

  it('detecta conflictos al iniciar revisión', async () => {
    vi.mocked(AcreditacionDocumentalExterna.update)
      .mockResolvedValue([0] as any);

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
      })
    ).rejects.toThrow(
      'Otra solicitud inició la revisión de esta acreditación.'
    );
  });

  it('detecta conflictos al finalizar revisión', async () => {
    vi.mocked(AcreditacionDocumentalExterna.findByPk)
      .mockResolvedValue({
        ...acreditacionBase,
        estado: 'en_revision',
        revisado_por: 2,
      } as any);

    vi.mocked(AcreditacionDocumentalExterna.update)
      .mockResolvedValue([0] as any);

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'aprobar',
      })
    ).rejects.toThrow(
      'La acreditación fue modificada por otra solicitud.'
    );
  });

  it('mantiene autorización y actualización en la misma transacción', async () => {
    await revisarAcreditacionDocumentalExterna({
      ...solicitudBase,
      accion: 'iniciar_revision',
    });

    expect(autorizarRevisionDocumentalExterna)
      .toHaveBeenCalledWith({
        administradorId: 2,
        acreditacionId: 100,
        transaction: transaccion,
      });

    expect(AcreditacionDocumentalExterna.findByPk)
      .toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          transaction: transaccion,
        })
      );

    expect(AcreditacionDocumentalExterna.update)
      .toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          transaction: transaccion,
        })
      );
  });

  it('permite utilizar una transacción externa', async () => {
    const resultado =
      await revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
        transaction: transaccion,
      });

    expect(resultado.estado).toBe('en_revision');

    expect(sequelize.transaction)
      .not.toHaveBeenCalled();

    expect(AcreditacionDocumentalExterna.update)
      .toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          transaction: transaccion,
        })
      );
  });

  it('propaga errores de base de datos', async () => {
    vi.mocked(AcreditacionDocumentalExterna.update)
      .mockRejectedValue(
        new Error('Error de base de datos')
      );

    await expect(
      revisarAcreditacionDocumentalExterna({
        ...solicitudBase,
        accion: 'iniciar_revision',
      })
    ).rejects.toThrow(
      'Error de base de datos'
    );

    expect(sequelize.transaction)
      .toHaveBeenCalledOnce();
  });
});
