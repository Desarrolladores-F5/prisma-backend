import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  sequelize: {
    transaction: vi.fn(),
  },
  Documento: {
    findOne: vi.fn(),
  },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  resolverDestinatariosDocumento: vi.fn(),
  obtenerEmpresaAdministrador: vi.fn(),
  ErrorAsignacionDocumental: class ErrorAsignacionDocumental extends Error {
    constructor(
      public readonly estadoHttp: number,
      mensaje: string
    ) {
      super(mensaje);
      this.name = 'ErrorAsignacionDocumental';
    }
  },
}));

vi.mock('../src/services/registroAsignacionesDocumentales.service', () => ({
  registrarAsignacionesDocumentales: vi.fn(),
}));

vi.mock('../src/services/notificacionesAutomaticas.service', () => ({
  avisarAsignacionDocumental: vi.fn(),
}));

import { sequelize, Documento } from '../src/models';

import {
  resolverDestinatariosDocumento,
  obtenerEmpresaAdministrador,
} from '../src/services/asignacionDocumental.service';

import {
  registrarAsignacionesDocumentales,
} from '../src/services/registroAsignacionesDocumentales.service';

import {
  avisarAsignacionDocumental,
} from '../src/services/notificacionesAutomaticas.service';

import {
  ejecutarAsignacionDocumental,
} from '../src/services/coordinadorAsignacionesDocumentales.service';

describe('Coordinador de asignaciones documentales', () => {
  let transaccion: any;

  const solicitud = {
    administradorId: 2,
    documentoId: 8,
    nombreDocumento: 'Nombre enviado por el cliente',
    asignacionTipo: 'usuarios' as const,
    usuarioIds: [31],
  };

  beforeEach(() => {
    vi.resetAllMocks();

    transaccion = {
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(sequelize.transaction).mockResolvedValue(transaccion);

    vi.mocked(obtenerEmpresaAdministrador).mockResolvedValue(1);

    vi.mocked(Documento.findOne).mockResolvedValue({
      id: 8,
      nombre: 'Uso de extintores',
      empresa_id: 1,
    } as any);

    vi.mocked(resolverDestinatariosDocumento).mockResolvedValue([31]);

    vi.mocked(registrarAsignacionesDocumentales).mockResolvedValue([31]);

    vi.mocked(avisarAsignacionDocumental).mockResolvedValue(1);
  });

  it('valida que el documento pertenezca a la empresa del administrador', async () => {
    const resultado = await ejecutarAsignacionDocumental(solicitud);

    expect(resultado).toEqual([31]);

    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(2);

    expect(Documento.findOne).toHaveBeenCalledWith({
      where: {
        id: 8,
        empresa_id: 1,
      },
      attributes: ['id', 'nombre', 'empresa_id'],
    });

    expect(resolverDestinatariosDocumento).toHaveBeenCalledWith({
      administradorId: 2,
      asignacionTipo: 'usuarios',
      usuarioIds: [31],
      rolId: undefined,
    });
  });

  it('rechaza documentos de otra empresa antes de iniciar transacciones', async () => {
    vi.mocked(Documento.findOne).mockResolvedValueOnce(null);

    await expect(
      ejecutarAsignacionDocumental(solicitud)
    ).rejects.toMatchObject({
      estadoHttp: 404,
    });

    expect(Documento.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 8,
          empresa_id: 1,
        },
      })
    );

    expect(resolverDestinatariosDocumento).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(registrarAsignacionesDocumentales).not.toHaveBeenCalled();
    expect(avisarAsignacionDocumental).not.toHaveBeenCalled();
  });

  it('rechaza documentos inexistentes sin registrar asignaciones', async () => {
    vi.mocked(Documento.findOne).mockResolvedValueOnce(null);

    await expect(
      ejecutarAsignacionDocumental({
        ...solicitud,
        documentoId: 99999,
      })
    ).rejects.toMatchObject({
      estadoHttp: 404,
    });

    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(registrarAsignacionesDocumentales).not.toHaveBeenCalled();
    expect(avisarAsignacionDocumental).not.toHaveBeenCalled();
  });

  it('rechaza identificadores de documento inválidos', async () => {
    await expect(
      ejecutarAsignacionDocumental({
        ...solicitud,
        documentoId: -1,
      })
    ).rejects.toMatchObject({
      estadoHttp: 400,
    });

    expect(obtenerEmpresaAdministrador).not.toHaveBeenCalled();
    expect(Documento.findOne).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

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
