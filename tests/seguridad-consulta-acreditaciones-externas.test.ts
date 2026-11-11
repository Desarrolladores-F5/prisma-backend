// tests/seguridad-consulta-acreditaciones-externas.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'sequelize';

vi.mock('../src/models', () => ({
  Usuario: {
    findByPk: vi.fn(),
  },
  Faena: {
    findByPk: vi.fn(),
  },
  Empresa: {
    findByPk: vi.fn(),
  },
  ContratoExterno: {
    findByPk: vi.fn(),
  },
  UsuarioEmpresaExterna: {
    findOne: vi.fn(),
  },
  AcreditacionDocumentalExterna: {
    findAndCountAll: vi.fn(),
  },
}));

import {
  Usuario,
  Faena,
  Empresa,
  ContratoExterno,
  UsuarioEmpresaExterna,
  AcreditacionDocumentalExterna,
} from '../src/models';

import {
  obtenerAcreditacionesExternasContrato,
  ErrorConsultaAcreditacionesExternas,
} from '../src/services/consultaAcreditacionesExternas.service';

describe('Seguridad multiempresa - consulta de acreditaciones externas', () => {
  const usuarioMandante = {
    id: 10,
    rol_id: 1,
    activo: true,
    faena_id: 20,
  };

  const usuarioContratista = {
    id: 11,
    rol_id: 3,
    activo: true,
    faena_id: null,
  };

  const contrato = {
    id: 15,
    mandante_empresa_id: 1,
    contratista_empresa_id: 3,
  };

  const empresaActiva = {
    id: 1,
    get: vi.fn().mockReturnValue(true),
  };

  const faenaMandante = {
    id: 20,
    get: vi.fn().mockReturnValue(1),
  };

  const resultadoDocumental = {
    count: 1,
    rows: [
      {
        id: 100,
        contrato_id: 15,
        documento_id: 45,
        requisito_id: 30,
        estado: 'pendiente',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(Usuario.findByPk).mockResolvedValue(
      usuarioMandante as any
    );

    vi.mocked(ContratoExterno.findByPk).mockResolvedValue(
      contrato as any
    );

    vi.mocked(Faena.findByPk).mockResolvedValue(
      faenaMandante as any
    );

    vi.mocked(Empresa.findByPk).mockResolvedValue(
      empresaActiva as any
    );

    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue(
      null
    );

    vi.mocked(
      AcreditacionDocumentalExterna.findAndCountAll
    ).mockResolvedValue(resultadoDocumental as any);
  });

  it('permite consultar a un administrador de la mandante', async () => {
    const resultado = await obtenerAcreditacionesExternasContrato({
      usuarioId: 10,
      contratoId: 15,
    });

    expect(resultado.tipoAcceso).toBe('mandante');
    expect(resultado.contratoId).toBe(15);
    expect(resultado.total).toBe(1);
    expect(resultado.acreditaciones).toHaveLength(1);

    expect(UsuarioEmpresaExterna.findOne).not.toHaveBeenCalled();

    expect(Empresa.findByPk).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        attributes: ['id', 'activo'],
      })
    );

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contrato_id: 15 },
        limit: 20,
        offset: 0,
      })
    );
  });

  it('permite consultar al administrador externo autorizado', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue(
      usuarioContratista as any
    );

    vi.mocked(UsuarioEmpresaExterna.findOne).mockResolvedValue({
      id: 50,
      empresa_id: 3,
      activo: true,
    } as any);

    const resultado = await obtenerAcreditacionesExternasContrato({
      usuarioId: 11,
      contratoId: 15,
    });

    expect(resultado.tipoAcceso).toBe('contratista');

    expect(UsuarioEmpresaExterna.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          usuario_id: 11,
          empresa_id: 3,
          perfil: 'administrador_externo',
          activo: true,
        },
      })
    );

    expect(Empresa.findByPk).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        attributes: ['id', 'activo'],
      })
    );
  });

  it('rechaza identificadores inválidos antes de consultar', async () => {
    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: -1,
        contratoId: 15,
      })
    ).rejects.toMatchObject({
      estadoHttp: 400,
    });

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 0,
      })
    ).rejects.toBeInstanceOf(ErrorConsultaAcreditacionesExternas);

    expect(Usuario.findByPk).not.toHaveBeenCalled();

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).not.toHaveBeenCalled();
  });

  it('rechaza usuarios inactivos', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      ...usuarioMandante,
      activo: false,
    } as any);

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
      })
    ).rejects.toMatchObject({
      estadoHttp: 403,
    });

    expect(ContratoExterno.findByPk).not.toHaveBeenCalled();
    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).not.toHaveBeenCalled();
  });

  it('rechaza contratos inexistentes', async () => {
    vi.mocked(ContratoExterno.findByPk).mockResolvedValue(null);

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
      })
    ).rejects.toMatchObject({
      estadoHttp: 404,
    });

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).not.toHaveBeenCalled();
  });

  it('rechaza administradores de una mandante diferente', async () => {
    vi.mocked(Faena.findByPk).mockResolvedValue({
      id: 20,
      get: vi.fn().mockReturnValue(99),
    } as any);

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
      })
    ).rejects.toMatchObject({
      estadoHttp: 403,
    });

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).not.toHaveBeenCalled();
  });

  it('rechaza contratistas sin vinculación administrativa', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue(
      usuarioContratista as any
    );

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 11,
        contratoId: 15,
      })
    ).rejects.toMatchObject({
      estadoHttp: 403,
    });

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).not.toHaveBeenCalled();
  });

  it('rechaza una empresa inactiva', async () => {
    vi.mocked(Empresa.findByPk).mockResolvedValue({
      id: 1,
      get: vi.fn().mockReturnValue(false),
    } as any);

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
      })
    ).rejects.toMatchObject({
      estadoHttp: 403,
    });

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).not.toHaveBeenCalled();
  });

  it('rechaza límites de paginación superiores a 100', async () => {
    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
        limite: 101,
      })
    ).rejects.toMatchObject({
      estadoHttp: 400,
    });

    expect(Usuario.findByPk).not.toHaveBeenCalled();
  });

  it('rechaza páginas inválidas y desplazamientos inseguros', async () => {
    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
        pagina: 0,
      })
    ).rejects.toMatchObject({
      estadoHttp: 400,
    });

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
        pagina: Number.MAX_SAFE_INTEGER,
        limite: 100,
      })
    ).rejects.toMatchObject({
      estadoHttp: 400,
    });

    expect(Usuario.findByPk).not.toHaveBeenCalled();
  });

  it('aplica correctamente la paginación solicitada', async () => {
    const resultado = await obtenerAcreditacionesExternasContrato({
      usuarioId: 10,
      contratoId: 15,
      pagina: 3,
      limite: 10,
    });

    expect(resultado.pagina).toBe(3);
    expect(resultado.limite).toBe(10);

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contrato_id: 15 },
        limit: 10,
        offset: 20,
      })
    );
  });

  it('selecciona atributos documentales explícitos', async () => {
    await obtenerAcreditacionesExternasContrato({
      usuarioId: 10,
      contratoId: 15,
    });

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.arrayContaining([
          'id',
          'contrato_id',
          'requisito_id',
          'documento_id',
          'estado',
          'observaciones',
          'fecha_presentacion',
          'fecha_revision',
        ]),
      })
    );
  });

  it('propaga la transacción a todas las consultas', async () => {
    const transaction = {
      id: 'transaccion-prueba',
    } as unknown as Transaction;

    await obtenerAcreditacionesExternasContrato({
      usuarioId: 10,
      contratoId: 15,
      transaction,
    });

    expect(Usuario.findByPk).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ transaction })
    );

    expect(ContratoExterno.findByPk).toHaveBeenCalledWith(
      15,
      expect.objectContaining({ transaction })
    );

    expect(Faena.findByPk).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ transaction })
    );

    expect(Empresa.findByPk).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ transaction })
    );

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).toHaveBeenCalledWith(
      expect.objectContaining({ transaction })
    );
  });

  it('no concede acceso cuando falla una consulta interna', async () => {
    vi.mocked(Faena.findByPk).mockRejectedValueOnce(
      new Error('Fallo interno simulado')
    );

    await expect(
      obtenerAcreditacionesExternasContrato({
        usuarioId: 10,
        contratoId: 15,
      })
    ).rejects.toThrow('Fallo interno simulado');

    expect(UsuarioEmpresaExterna.findOne).not.toHaveBeenCalled();

    expect(
      AcreditacionDocumentalExterna.findAndCountAll
    ).not.toHaveBeenCalled();
  });
});
