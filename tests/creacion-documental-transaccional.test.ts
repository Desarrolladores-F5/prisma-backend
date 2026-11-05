import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  sequelize: { transaction: vi.fn() },
  Documento: { create: vi.fn() },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  resolverDestinatariosDocumento: vi.fn(),
  obtenerEmpresaAdministrador: vi.fn(),
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
import { registrarAsignacionesDocumentales } from '../src/services/registroAsignacionesDocumentales.service';
import { avisarAsignacionDocumental } from '../src/services/notificacionesAutomaticas.service';
import { crearDocumentoConAsignaciones } from '../src/services/creacionDocumental.service';

describe('Creación documental transaccional', () => {
  let transaccion: any;

  const solicitud = {
    administradorId: 2,
    nombre: 'Documento de prueba',
    tipo: 'PDF',
    url: '/uploads/prueba.pdf',
    version: '1.0',
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
    vi.mocked(resolverDestinatariosDocumento).mockResolvedValue([31]);

    vi.mocked(Documento.create).mockResolvedValue({
      id: 88,
      nombre: 'Documento de prueba',
      empresa_id: 1,
    } as any);

    vi.mocked(registrarAsignacionesDocumentales).mockResolvedValue([31]);
    vi.mocked(avisarAsignacionDocumental).mockResolvedValue(1);
  });

  it('crea documento y asignaciones en la misma transacción', async () => {
    await crearDocumentoConAsignaciones(solicitud);

    expect(Documento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: 'Documento de prueba',
      }),
      { transaction: transaccion }
    );

    expect(registrarAsignacionesDocumentales).toHaveBeenCalledWith({
      documentoId: 88,
      destinatariosIds: [31],
      transaccion,
    });

    expect(transaccion.commit).toHaveBeenCalledOnce();
    expect(transaccion.rollback).not.toHaveBeenCalled();
  });

  it('guarda la empresa real del administrador en el documento', async () => {
    await crearDocumentoConAsignaciones(solicitud);

    expect(obtenerEmpresaAdministrador).toHaveBeenCalledWith(2);

    expect(Documento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        empresa_id: 1,
      }),
      { transaction: transaccion }
    );
  });

  it('no crea documentos cuando falla la autorización de destinatarios', async () => {
    vi.mocked(resolverDestinatariosDocumento).mockRejectedValue(
      new Error('Destinatario de otra empresa')
    );

    await expect(
      crearDocumentoConAsignaciones(solicitud)
    ).rejects.toThrow('Destinatario de otra empresa');

    expect(Documento.create).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(avisarAsignacionDocumental).not.toHaveBeenCalled();
  });

  it('revierte documento y asignaciones cuando falla el registro', async () => {
    vi.mocked(registrarAsignacionesDocumentales).mockRejectedValue(
      new Error('Fallo simulado de asignación')
    );

    await expect(
      crearDocumentoConAsignaciones(solicitud)
    ).rejects.toThrow('Fallo simulado de asignación');

    expect(transaccion.rollback).toHaveBeenCalledOnce();
    expect(transaccion.commit).not.toHaveBeenCalled();
    expect(avisarAsignacionDocumental).not.toHaveBeenCalled();
  });

  it('notifica únicamente después de confirmar la transacción', async () => {
    await crearDocumentoConAsignaciones(solicitud);

    expect(avisarAsignacionDocumental).toHaveBeenCalledWith({
      documentoId: 88,
      nombreDocumento: 'Documento de prueba',
      destinatariosIds: [31],
    });

    expect(transaccion.commit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(avisarAsignacionDocumental).mock.invocationCallOrder[0]
    );
  });
});
