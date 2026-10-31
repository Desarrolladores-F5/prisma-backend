import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Usuario: {
    findByPk: vi.fn(),
    findAll: vi.fn(),
  },
  Faena: {
    findByPk: vi.fn(),
  },
}));

import { Usuario, Faena } from '../src/models';
import { resolverDestinatariosDocumento } from '../src/services/asignacionDocumental.service';

describe('Seguridad multiempresa de asignaciones documentales', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 2,
      rol_id: 1,
      activo: true,
      faena_id: 3,
    } as any);

    vi.mocked(Faena.findByPk).mockResolvedValue({
      id: 3,
      empresa_id: 1,
      get: vi.fn().mockReturnValue(1),
    } as any);
  });

  it('autoriza únicamente destinatarios activos de la misma empresa', async () => {
    vi.mocked(Usuario.findAll).mockResolvedValue([
      { id: 31 },
    ] as any);

    const resultado = await resolverDestinatariosDocumento({
      administradorId: 2,
      asignacionTipo: 'usuarios',
      usuarioIds: [31],
    });

    expect(resultado).toEqual([31]);

    expect(Usuario.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activo: true,
        }),
        include: [
          expect.objectContaining({
            model: Faena,
            as: 'faena',
            required: true,
            where: { empresa_id: 1 },
          }),
        ],
      })
    );
  });

  it('rechaza toda la solicitud si incluye un usuario de otra empresa', async () => {
    // Solo el usuario 31 coincide con la empresa autorizada.
    vi.mocked(Usuario.findAll).mockResolvedValue([
      { id: 31 },
    ] as any);

    await expect(
      resolverDestinatariosDocumento({
        administradorId: 2,
        asignacionTipo: 'usuarios',
        usuarioIds: [31, 99],
      })
    ).rejects.toThrow();
  });

  it('rechaza administradores sin empresa verificable', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 2,
      rol_id: 1,
      activo: true,
      faena_id: null,
    } as any);

    await expect(
      resolverDestinatariosDocumento({
        administradorId: 2,
        asignacionTipo: 'usuarios',
        usuarioIds: [31],
      })
    ).rejects.toThrow();

    expect(Usuario.findAll).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de destinatarios inválidos', async () => {
    await expect(
      resolverDestinatariosDocumento({
        administradorId: 2,
        asignacionTipo: 'usuarios',
        usuarioIds: [31, -5],
      })
    ).rejects.toThrow();
  });
});
