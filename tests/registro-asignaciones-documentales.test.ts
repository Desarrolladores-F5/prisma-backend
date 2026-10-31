import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  RelDocumentoUsuario: {
    findOrCreate: vi.fn(),
  },
}));

import { RelDocumentoUsuario } from '../src/models';
import { registrarAsignacionesDocumentales } from '../src/services/registroAsignacionesDocumentales.service';

describe('Registro seguro de asignaciones documentales', () => {
  const transaccion = { id: 'transaccion-simulada' } as any;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registra únicamente las asignaciones nuevas', async () => {
    vi.mocked(RelDocumentoUsuario.findOrCreate)
      .mockResolvedValueOnce([{} as any, true])
      .mockResolvedValueOnce([{} as any, false]);

    const nuevas = await registrarAsignacionesDocumentales({
      documentoId: 8,
      destinatariosIds: [31, 23],
      transaccion,
    });

    expect(nuevas).toEqual([31]);
    expect(RelDocumentoUsuario.findOrCreate).toHaveBeenCalledTimes(2);

    expect(RelDocumentoUsuario.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documento_id: 8, usuario_id: 31 },
        transaction: transaccion,
      })
    );
  });

  it('no registra dos veces al mismo destinatario', async () => {
    vi.mocked(RelDocumentoUsuario.findOrCreate)
      .mockResolvedValueOnce([{} as any, true]);

    const nuevas = await registrarAsignacionesDocumentales({
      documentoId: 8,
      destinatariosIds: [31, 31],
      transaccion,
    });

    expect(nuevas).toEqual([31]);
    expect(RelDocumentoUsuario.findOrCreate).toHaveBeenCalledOnce();
  });

  it('no genera asignaciones nuevas cuando todas existen', async () => {
    vi.mocked(RelDocumentoUsuario.findOrCreate)
      .mockResolvedValueOnce([{} as any, false]);

    const nuevas = await registrarAsignacionesDocumentales({
      documentoId: 8,
      destinatariosIds: [31],
      transaccion,
    });

    expect(nuevas).toEqual([]);
  });

  it('rechaza identificadores inválidos antes de escribir', async () => {
    await expect(
      registrarAsignacionesDocumentales({
        documentoId: 8,
        destinatariosIds: [31, -1],
        transaccion,
      })
    ).rejects.toThrow();

    expect(RelDocumentoUsuario.findOrCreate).not.toHaveBeenCalled();
  });
});
