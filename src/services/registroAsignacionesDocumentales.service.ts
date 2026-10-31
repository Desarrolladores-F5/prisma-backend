import type { Transaction } from 'sequelize';
import { RelDocumentoUsuario } from '../models';

interface SolicitudRegistroAsignaciones {
  documentoId: number;
  destinatariosIds: number[];
  transaccion: Transaction;
}

export const registrarAsignacionesDocumentales = async ({
  documentoId,
  destinatariosIds,
  transaccion,
}: SolicitudRegistroAsignaciones): Promise<number[]> => {
  const idValido = (valor: unknown): valor is number =>
    typeof valor === 'number' &&
    Number.isSafeInteger(valor) &&
    valor > 0;

  if (!idValido(documentoId)) {
    throw new Error('Identificador de documento inválido.');
  }

  if (
    !Array.isArray(destinatariosIds) ||
    destinatariosIds.length === 0 ||
    !destinatariosIds.every(idValido)
  ) {
    throw new Error('Destinatarios inválidos.');
  }

  if (!transaccion) {
    throw new Error('Se requiere una transacción activa.');
  }

  const destinatariosUnicos = [...new Set(destinatariosIds)];
  const nuevasAsignaciones: number[] = [];

  for (const usuarioId of destinatariosUnicos) {
    const [, creada] = await RelDocumentoUsuario.findOrCreate({
      where: {
        documento_id: documentoId,
        usuario_id: usuarioId,
      },
      defaults: {
        documento_id: documentoId,
        usuario_id: usuarioId,
        fecha_asignacion: new Date(),
        recepcionado: false,
      },
      transaction: transaccion,
    });

    if (creada) {
      nuevasAsignaciones.push(usuarioId);
    }
  }

  return nuevasAsignaciones;
};
