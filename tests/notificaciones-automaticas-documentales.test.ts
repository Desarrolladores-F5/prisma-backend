import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  Usuario: {
    findByPk: vi.fn(),
    findAll: vi.fn(),
  },
  Faena: {
    findByPk: vi.fn(),
  },
  Notificacion: {
    findOrCreate: vi.fn(),
  },
}));

import { Usuario, Faena, Notificacion } from '../src/models';
import { avisarRecepcionDocumental } from '../src/services/notificacionesAutomaticas.service';

describe('Notificaciones automáticas de recepción documental', () => {
  const solicitud = {
    usuarioId: 23,
    documentoId: 87,
    nombreDocumento: 'Procedimiento de seguridad',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const prepararTrabajador = () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 23,
      nombre: 'Trabajador',
      apellido: 'Prueba',
      faena_id: 3,
    } as any);

    vi.mocked(Faena.findByPk).mockResolvedValue({
      id: 3,
      get: vi.fn().mockReturnValue(1),
    } as any);
  };

  it('crea un aviso único para cada administrador destinatario', async () => {
    prepararTrabajador();

    vi.mocked(Usuario.findAll).mockResolvedValue([
      { id: 2 },
      { id: 11 },
    ] as any);

    vi.mocked(Notificacion.findOrCreate)
      .mockResolvedValueOnce([{} as any, true])
      .mockResolvedValueOnce([{} as any, true]);

    const creadas = await avisarRecepcionDocumental(solicitud);

    expect(creadas).toBe(2);
    expect(Notificacion.findOrCreate).toHaveBeenCalledTimes(2);

    for (const adminId of [2, 11]) {
      expect(Notificacion.findOrCreate).toHaveBeenCalledWith({
        where: {
          usuario_id: adminId,
          clave_evento: 'recepcion_documental:87:23',
        },
        defaults: expect.objectContaining({
          usuario_id: adminId,
          clave_evento: 'recepcion_documental:87:23',
          tipo: 'recepcion_documental',
          origen: 'documentos',
          faena_id: 3,
          leido: false,
          activo: true,
        }),
      });
    }
  });

  it('omite una notificación que ya existe para el mismo destinatario', async () => {
    prepararTrabajador();

    vi.mocked(Usuario.findAll).mockResolvedValue([
      { id: 2 },
      { id: 11 },
    ] as any);

    vi.mocked(Notificacion.findOrCreate)
      .mockResolvedValueOnce([{} as any, false])
      .mockResolvedValueOnce([{} as any, true]);

    const creadas = await avisarRecepcionDocumental(solicitud);

    expect(creadas).toBe(1);
    expect(Notificacion.findOrCreate).toHaveBeenCalledTimes(2);
  });

  it('limita los destinatarios a administradores activos de la misma empresa', async () => {
    prepararTrabajador();

    vi.mocked(Usuario.findAll).mockResolvedValue([] as any);

    const creadas = await avisarRecepcionDocumental(solicitud);

    expect(creadas).toBe(0);

    expect(Usuario.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          rol_id: 1,
          activo: true,
        },
        include: [
          expect.objectContaining({
            model: Faena,
            as: 'faena',
            required: true,
            where: {
              empresa_id: 1,
            },
          }),
        ],
      })
    );

    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });

  it('no envía avisos cuando el trabajador no tiene faena', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 23,
      faena_id: null,
    } as any);

    const creadas = await avisarRecepcionDocumental(solicitud);

    expect(creadas).toBe(0);
    expect(Usuario.findAll).not.toHaveBeenCalled();
    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });

  it('rechaza identificadores inválidos', async () => {
    await expect(
      avisarRecepcionDocumental({
        ...solicitud,
        usuarioId: -1,
      })
    ).rejects.toThrow('Identificadores de recepción inválidos.');

    expect(Usuario.findByPk).not.toHaveBeenCalled();
    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });
});
