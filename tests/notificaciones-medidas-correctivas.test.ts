import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  MedidaCorrectiva: { findByPk: vi.fn() },
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
  Documento: {},
}));

import { MedidaCorrectiva, Usuario, Faena, Notificacion } from '../src/models';
import {
  avisarMedidaCorrectiva,
} from '../src/services/notificacionesAutomaticas.service';

describe('Notificaciones de medidas correctivas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(MedidaCorrectiva.findByPk).mockResolvedValue({
      id: 4, faena_id: 3, responsable_id: 23,
    } as any);

    vi.mocked(Usuario.findByPk).mockResolvedValue({
      id: 23,
      nombre: 'Trabajador',
      apellido: 'Prueba',
      faena_id: 3,
      activo: true,
    } as any);

    vi.mocked(Faena.findByPk).mockImplementation(
      async (_id: any, opciones: any) => {
        if (opciones?.attributes?.includes('responsable_id')) {
          return {
            get: (campo: string) =>
              campo === 'responsable_id' ? 9 : undefined,
          } as any;
        }

        return {
          get: (campo: string) => {
            if (campo === 'empresa_id') return 1;
            if (campo === 'activo') return true;
            return undefined;
          },
        } as any;
      }
    );

    vi.mocked(Usuario.findAll).mockImplementation(
      async (opciones: any) => {
        if (opciones?.where?.rol_id === 1) {
          return [{ id: 2 }, { id: 11 }] as any;
        }

        if (opciones?.where?.rol_id === 2) {
          return [{ id: 9 }] as any;
        }

        return [] as any;
      }
    );

    vi.mocked(Notificacion.findOrCreate).mockResolvedValue([
      {} as any,
      true,
    ]);
  });

  const solicitud = {
    medidaId: 4,
    descripcion: 'Revisar condiciones de seguridad',
    responsableId: 23,
  };

  it('notifica al responsable, administradores y supervisor de la faena', async () => {
    const cantidad = await avisarMedidaCorrectiva(solicitud);

    expect(cantidad).toBe(4);
    expect(Notificacion.findOrCreate).toHaveBeenCalledTimes(4);

    const destinatarios = vi.mocked(Notificacion.findOrCreate)
      .mock.calls.map(([opciones]: any[]) => opciones.where.usuario_id);

    expect(destinatarios.sort((a: number, b: number) => a - b))
      .toEqual([2, 9, 11, 23]);
  });

  it('no selecciona supervisores de otras faenas', async () => {
    await avisarMedidaCorrectiva(solicitud);

    expect(Usuario.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 9,
          rol_id: 2,
          activo: true,
        },
      })
    );

    const destinatarios = vi.mocked(Notificacion.findOrCreate)
      .mock.calls.map(([opciones]: any[]) => opciones.where.usuario_id);

    expect(destinatarios).not.toContain(29);
  });

  it('rechaza responsables inactivos', async () => {
    vi.mocked(Usuario.findByPk).mockResolvedValueOnce({
      id: 23,
      faena_id: 3,
      activo: false,
    } as any);

    await expect(
      avisarMedidaCorrectiva(solicitud)
    ).rejects.toThrow(
      'El responsable debe estar activo y tener una faena válida.'
    );

    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });

  it('rechaza faenas inactivas', async () => {
    vi.mocked(Faena.findByPk).mockResolvedValueOnce({
      get: (campo: string) => {
        if (campo === 'empresa_id') return 1;
        if (campo === 'activo') return false;
        return undefined;
      },
    } as any);

    await expect(
      avisarMedidaCorrectiva(solicitud)
    ).rejects.toThrow(
      'No se encontró una faena activa para la medida.'
    );

    expect(Notificacion.findOrCreate).not.toHaveBeenCalled();
  });

  it('evita duplicados mediante claves individuales', async () => {
    vi.mocked(Notificacion.findOrCreate).mockResolvedValue([
      {} as any,
      false,
    ]);

    const cantidad = await avisarMedidaCorrectiva(solicitud);

    expect(cantidad).toBe(0);

    for (const [opciones] of vi.mocked(Notificacion.findOrCreate).mock.calls) {
      const datos = opciones as any;

      expect(datos.where.clave_evento).toBe(
        `medida_correctiva:4:${datos.where.usuario_id}`
      );
    }
  });
});
