import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  sequelize: {
    query: vi.fn(),
  },
}));

vi.mock('../src/services/autorizacionEmpresasExternas.service', () => ({
  autorizarAdministradorContratoExterno: vi.fn(),
}));

import { sequelize } from '../src/models';

import {
  autorizarAdministradorContratoExterno,
} from '../src/services/autorizacionEmpresasExternas.service';

import {
  autorizarPresentacionDocumentalExterna,
  ErrorPresentacionDocumentalExterna,
} from '../src/services/autorizacionPresentacionDocumentalExterna.service';

describe('Seguridad de presentación documental externa', () => {
  const solicitudBase = {
    administradorId: 9,
    contratoId: 50,
    requisitoId: 100,
    documentoId: 200,
    contratoTrabajadorId: null,
  };

  const registroBase = {
    contrato_id: 50,
    contratista_empresa_id: 3,
    estado_contrato: 'pendiente',
    empresa_activa: 1,
    requisito_id: 100,
    destinatario: 'empresa',
    documento_id: 200,
    empresa_documento_id: 3,
    trabajador_vinculado_id: null,
    trabajador_activo: null,
    usuario_trabajador_activo: null,
  };

  const ejecutarConsulta = vi.mocked(sequelize.query);

  const establecerRegistro = (
    cambios: Record<string, unknown> = {}
  ) => {
    ejecutarConsulta.mockResolvedValue([
      {
        ...registroBase,
        ...cambios,
      },
    ] as any);
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(autorizarAdministradorContratoExterno)
      .mockResolvedValue({
        usuarioId: 9,
        empresaId: 3,
        contratoId: 50,
      });

    establecerRegistro();
  });

  it('autoriza un documento empresarial válido', async () => {
    const resultado = await autorizarPresentacionDocumentalExterna(
      solicitudBase
    );

    expect(resultado).toEqual({
      administradorId: 9,
      contratoId: 50,
      empresaId: 3,
      requisitoId: 100,
      documentoId: 200,
      contratoTrabajadorId: null,
      destinatario: 'empresa',
    });
  });

  it('rechaza identificadores inválidos antes de consultar', async () => {
    await expect(
      autorizarPresentacionDocumentalExterna({
        ...solicitudBase,
        documentoId: -1,
      })
    ).rejects.toBeInstanceOf(
      ErrorPresentacionDocumentalExterna
    );

    expect(autorizarAdministradorContratoExterno)
      .not.toHaveBeenCalled();

    expect(ejecutarConsulta).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de trabajador inválidos', async () => {
    await expect(
      autorizarPresentacionDocumentalExterna({
        ...solicitudBase,
        contratoTrabajadorId: 0,
      })
    ).rejects.toThrow(
      'Identificador de trabajador vinculado inválido.'
    );

    expect(ejecutarConsulta).not.toHaveBeenCalled();
  });

  it('rechaza administradores sin autorización contractual', async () => {
    vi.mocked(autorizarAdministradorContratoExterno)
      .mockRejectedValue(
        new Error('Contrato no autorizado')
      );

    await expect(
      autorizarPresentacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow('Contrato no autorizado');

    expect(ejecutarConsulta).not.toHaveBeenCalled();
  });

  it('rechaza documentos o requisitos no disponibles', async () => {
    ejecutarConsulta.mockResolvedValue([] as any);

    await expect(
      autorizarPresentacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'El requisito o documento no está disponible para este contrato.'
    );
  });

  it('rechaza empresas contratistas inactivas', async () => {
    establecerRegistro({ empresa_activa: 0 });

    await expect(
      autorizarPresentacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'La empresa contratista se encuentra inactiva.'
    );
  });

  it('permite acreditación inicial con contrato pendiente', async () => {
    establecerRegistro({ estado_contrato: 'pendiente' });

    const resultado = await autorizarPresentacionDocumentalExterna(
      solicitudBase
    );

    expect(resultado.contratoId).toBe(50);
  });

  it('permite renovación documental con contrato activo', async () => {
    establecerRegistro({ estado_contrato: 'activo' });

    const resultado = await autorizarPresentacionDocumentalExterna(
      solicitudBase
    );

    expect(resultado.contratoId).toBe(50);
  });

  it.each(['suspendido', 'finalizado', 'cancelado'])(
    'rechaza contrato con estado %s',
    async (estado) => {
      establecerRegistro({ estado_contrato: estado });

      await expect(
        autorizarPresentacionDocumentalExterna(solicitudBase)
      ).rejects.toThrow(
        'El contrato no admite presentaciones documentales.'
      );
    }
  );

  it('rechaza documentos pertenecientes a otra empresa', async () => {
    establecerRegistro({ empresa_documento_id: 4 });

    await expect(
      autorizarPresentacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'El documento no pertenece a la empresa contratista.'
    );
  });

  it('rechaza documentos sin empresa asociada', async () => {
    establecerRegistro({ empresa_documento_id: null });

    await expect(
      autorizarPresentacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'El documento no pertenece a la empresa contratista.'
    );
  });

  it('rechaza trabajador en un requisito empresarial', async () => {
    await expect(
      autorizarPresentacionDocumentalExterna({
        ...solicitudBase,
        contratoTrabajadorId: 300,
      })
    ).rejects.toThrow(
      'Un requisito empresarial no debe vincularse a un trabajador.'
    );
  });

  it('exige trabajador para requisitos individuales', async () => {
    establecerRegistro({ destinatario: 'trabajador' });

    await expect(
      autorizarPresentacionDocumentalExterna(solicitudBase)
    ).rejects.toThrow(
      'El requisito exige identificar al trabajador vinculado.'
    );
  });

  it('autoriza un documento individual con trabajador activo', async () => {
    establecerRegistro({
      destinatario: 'trabajador',
      trabajador_vinculado_id: 300,
      trabajador_activo: 1,
      usuario_trabajador_activo: 1,
    });

    const resultado = await autorizarPresentacionDocumentalExterna({
      ...solicitudBase,
      contratoTrabajadorId: 300,
    });

    expect(resultado.contratoTrabajadorId).toBe(300);
    expect(resultado.destinatario).toBe('trabajador');
  });

  it('rechaza trabajadores vinculados a otro contrato', async () => {
    establecerRegistro({
      destinatario: 'trabajador',
      trabajador_vinculado_id: null,
    });

    await expect(
      autorizarPresentacionDocumentalExterna({
        ...solicitudBase,
        contratoTrabajadorId: 300,
      })
    ).rejects.toThrow(
      'El trabajador no mantiene una vinculación activa con el contrato.'
    );
  });

  it('rechaza vinculaciones de trabajadores inactivas', async () => {
    establecerRegistro({
      destinatario: 'trabajador',
      trabajador_vinculado_id: 300,
      trabajador_activo: 0,
      usuario_trabajador_activo: 1,
    });

    await expect(
      autorizarPresentacionDocumentalExterna({
        ...solicitudBase,
        contratoTrabajadorId: 300,
      })
    ).rejects.toThrow(
      'El trabajador no mantiene una vinculación activa con el contrato.'
    );
  });

  it('rechaza cuentas de trabajadores inactivas', async () => {
    establecerRegistro({
      destinatario: 'trabajador',
      trabajador_vinculado_id: 300,
      trabajador_activo: 1,
      usuario_trabajador_activo: 0,
    });

    await expect(
      autorizarPresentacionDocumentalExterna({
        ...solicitudBase,
        contratoTrabajadorId: 300,
      })
    ).rejects.toThrow(
      'El trabajador no mantiene una vinculación activa con el contrato.'
    );
  });

  it('propaga la transacción a las validaciones', async () => {
    const transaction = { id: 'transaccion-prueba' } as any;

    await autorizarPresentacionDocumentalExterna({
      ...solicitudBase,
      transaction,
    });

    expect(autorizarAdministradorContratoExterno)
      .toHaveBeenCalledWith(
        9,
        50,
        { transaction }
      );

    expect(ejecutarConsulta).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        transaction,
        replacements: expect.objectContaining({
          contratoId: 50,
          requisitoId: 100,
          documentoId: 200,
          empresaId: 3,
        }),
      })
    );
  });
});
