import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  sequelize: {
    transaction: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  resolverDestinatariosDocumento: vi.fn(),
}));

vi.mock('../src/services/registroAsignacionesDocumentales.service', () => ({
  registrarAsignacionesDocumentales: vi.fn(),
}));

vi.mock('../src/services/notificacionesAutomaticas.service', () => ({
  avisarAsignacionDocumental: vi.fn(),
}));

import { sequelize } from '../src/models';
import { resolverDestinatariosDocumento } from '../src/services/asignacionDocumental.service';
import { registrarAsignacionesDocumentales } from '../src/services/registroAsignacionesDocumentales.service';
import { avisarAsignacionDocumental } from '../src/services/notificacionesAutomaticas.service';
import { ejecutarAsignacionDocumental } from '../src/services/coordinadorAsignacionesDocumentales.service';

describe('Coordinador de asignaciones documentales', () => {
  let transaccion: any;

  beforeEach(() => {
    vi.resetAllMocks();

    transaccion = {
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(sequelize.transaction).mockResolvedValue(transaccion);
    vi.mocked(resolverDestinatariosDocumento).mockResolvedValue([31]);
    vi.mocked(registrarAsignacionesDocumentales).mockResolvedValue([31]);
    vi.mocked(avisarAsignacionDocumental).mockResolvedValue(1);
  });

  const solicitud = {
    administradorId: 2,
    documentoId: 8,
    nombreDocumento: 'Uso de extintores',
    asignacionTipo: 'usuarios' as const,
    usuarioIds: [31],
  };

  it('notifica solo después de confirmar la transacción', async () => {
    const resultado = await ejecutarAsignacionDocumental(solicitud);

    expect(resultado).toEqual([31]);
    expect(transaccion.commit).toHaveBeenCalledOnce();
    expect(avisarAsignacionDocumental).toHaveBeenCalledWith({
      documentoId: 8,
      nombreDocumento: 'Uso de extintores',
      destinatariosIds: [31],
    });

    expect(transaccion.commit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(avisarAsignacionDocumental).mock.invocationCallOrder[0]
    );
  });

  it('no envía avisos por asignaciones existentes', async () => {
    vi.mocked(registrarAsignacionesDocumentales).mockResolvedValue([]);

    const resultado = await ejecutarAsignacionDocumental(solicitud);

    expect(resultado).toEqual([]);
    expect(transaccion.commit).toHaveBeenCalledOnce();
    expect(avisarAsignacionDocumental).not.toHaveBeenCalled();
  });

  it('revierte la transacción cuando falla el registro', async () => {
    vi.mocked(registrarAsignacionesDocumentales).mockRejectedValue(
      new Error('Fallo simulado al asignar')
    );

    await expect(
      ejecutarAsignacionDocumental(solicitud)
    ).rejects.toThrow('Fallo simulado al asignar');

    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();
    expect(avisarAsignacionDocumental).not.toHaveBeenCalled();
  });

  it('conserva la asignación confirmada si falla el aviso', async () => {
    vi.mocked(avisarAsignacionDocumental).mockRejectedValue(
      new Error('Fallo simulado del aviso')
    );

    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const resultado = await ejecutarAsignacionDocumental(solicitud);

      expect(resultado).toEqual([31]);
      expect(transaccion.commit).toHaveBeenCalledOnce();
      expect(transaccion.rollback).not.toHaveBeenCalled();
    } finally {
      consola.mockRestore();
    }
  });
});
