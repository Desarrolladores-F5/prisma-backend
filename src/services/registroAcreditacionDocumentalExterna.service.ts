// src/services/registroAcreditacionDocumentalExterna.service.ts

import type { Transaction } from 'sequelize';

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../models';

import {
  autorizarPresentacionDocumentalExterna,
} from './autorizacionPresentacionDocumentalExterna.service';

export class ErrorRegistroAcreditacionExterna extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorRegistroAcreditacionExterna';
  }
}

export interface SolicitudRegistroAcreditacionExterna {
  administradorId: number;
  contratoId: number;
  requisitoId: number;
  documentoId: number;
  contratoTrabajadorId?: number | null;

  fechaEmision?: string | null;
  fechaVencimiento?: string | null;

  periodoInicio?: string | null;
  periodoTermino?: string | null;

  // Uso interno del backend. Nunca debe provenir de req.body.
  transaction?: Transaction;
}

const fechaValida = (valor: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false;
  }

  const fecha = new Date(`${valor}T00:00:00.000Z`);

  return (
    !Number.isNaN(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === valor
  );
};

const normalizarFecha = (
  valor: string | null | undefined,
  nombre: string
): string | null => {
  if (valor === undefined || valor === null) {
    return null;
  }

  if (typeof valor !== 'string' || !fechaValida(valor)) {
    throw new ErrorRegistroAcreditacionExterna(
      400,
      `${nombre} debe ser una fecha válida en formato YYYY-MM-DD.`
    );
  }

  return valor;
};

const validarOrdenFechas = (
  inicio: string | null,
  termino: string | null,
  descripcion: string
): void => {
  if (inicio && termino && termino < inicio) {
    throw new ErrorRegistroAcreditacionExterna(
      400,
      `${descripcion}: la fecha de término no puede ser anterior al inicio.`
    );
  }
};

/**
 * Registra una acreditación documental externa.
 *
 * Reglas:
 * - administradorId proviene del JWT verificado.
 * - La autorización se ejecuta antes de insertar.
 * - No acepta estado, presentado_por ni revisado_por del cliente.
 * - El estado inicial siempre es pendiente.
 * - No modifica ni elimina documentos existentes.
 * - Conserva cada presentación como un registro independiente.
 *
 * Si se proporciona una transacción, el llamador administra
 * su COMMIT o ROLLBACK.
 *
 * De lo contrario, Sequelize administra una transacción
 * propia y revierte automáticamente si ocurre un error.
 */
export const registrarAcreditacionDocumentalExterna = async ({
  administradorId,
  contratoId,
  requisitoId,
  documentoId,
  contratoTrabajadorId = null,
  fechaEmision,
  fechaVencimiento,
  periodoInicio,
  periodoTermino,
  transaction: transaccionExterna,
}: SolicitudRegistroAcreditacionExterna) => {
  const emision = normalizarFecha(
    fechaEmision,
    'La fecha de emisión'
  );

  const vencimiento = normalizarFecha(
    fechaVencimiento,
    'La fecha de vencimiento'
  );

  const inicioPeriodo = normalizarFecha(
    periodoInicio,
    'El inicio del período'
  );

  const terminoPeriodo = normalizarFecha(
    periodoTermino,
    'El término del período'
  );

  validarOrdenFechas(
    emision,
    vencimiento,
    'Vigencia documental'
  );

  validarOrdenFechas(
    inicioPeriodo,
    terminoPeriodo,
    'Período documental'
  );

  const ejecutarRegistro = async (transaction: Transaction) => {
    const autorizacion =
      await autorizarPresentacionDocumentalExterna({
        administradorId,
        contratoId,
        requisitoId,
        documentoId,
        contratoTrabajadorId,
        transaction,
      });

    return AcreditacionDocumentalExterna.create(
      {
        contrato_id: autorizacion.contratoId,
        requisito_id: autorizacion.requisitoId,
        documento_id: autorizacion.documentoId,

        contrato_trabajador_id:
          autorizacion.contratoTrabajadorId,

        fecha_emision: emision,
        fecha_vencimiento: vencimiento,

        periodo_inicio: inicioPeriodo,
        periodo_termino: terminoPeriodo,

        estado: 'pendiente',
        observaciones: null,

        presentado_por: autorizacion.administradorId,
        revisado_por: null,
        fecha_revision: null,
      },
      {
        transaction,
      }
    );
  };

  if (transaccionExterna) {
    return ejecutarRegistro(transaccionExterna);
  }

  return sequelize.transaction(ejecutarRegistro);
};
