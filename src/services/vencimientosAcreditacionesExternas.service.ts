// src/services/vencimientosAcreditacionesExternas.service.ts

import type {
  EstadoAcreditacionDocumentalExterna,
} from '../models/acreditacion_documental_externa.model';

export type ClasificacionVigenciaExterna =
  | 'vigente'
  | 'proximo_a_vencer'
  | 'vencido'
  | 'no_aplica';

export interface DatosVigenciaAcreditacionExterna {
  estado: EstadoAcreditacionDocumentalExterna;
  fechaVencimiento: string | null;
}

export interface ResultadoVigenciaAcreditacionExterna {
  clasificacion: ClasificacionVigenciaExterna;
  fechaActual: string;
  fechaVencimiento: string | null;
  diasRestantes: number | null;
}

const ZONA_HORARIA = 'America/Santiago';
const MILISEGUNDOS_DIA = 24 * 60 * 60 * 1000;

const formatoFechaChile = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const obtenerFechaActualChile = (
  instante: Date = new Date()
): string => {
  if (Number.isNaN(instante.getTime())) {
    throw new Error('Instante de referencia inválido.');
  }

  const partes = formatoFechaChile.formatToParts(instante);

  const obtener = (tipo: string): string => {
    const parte = partes.find(item => item.type === tipo);

    if (!parte) {
      throw new Error('No se pudo obtener la fecha de Chile.');
    }

    return parte.value;
  };

  return [
    obtener('year'),
    obtener('month'),
    obtener('day'),
  ].join('-');
};

const convertirFechaADiasUTC = (fecha: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('Fecha de vencimiento inválida.');
  }

  const fechaUTC = new Date(`${fecha}T00:00:00.000Z`);

  if (
    Number.isNaN(fechaUTC.getTime()) ||
    fechaUTC.toISOString().slice(0, 10) !== fecha
  ) {
    throw new Error('Fecha de vencimiento inválida.');
  }

  return Math.floor(
    fechaUTC.getTime() / MILISEGUNDOS_DIA
  );
};

/**
 * Clasifica una acreditación documental externa.
 *
 * Reglas:
 * - La fecha de referencia corresponde a America/Santiago.
 * - El documento sigue vigente durante su último día.
 * - Solo las acreditaciones aprobadas pueden pasar
 *   automáticamente al estado vencido.
 * - Las acreditaciones ya vencidas conservan su clasificación.
 * - No modifica registros ni genera notificaciones.
 */
export const clasificarVigenciaAcreditacionExterna = (
  datos: DatosVigenciaAcreditacionExterna,
  opciones: {
    instante?: Date;
    diasAviso?: number;
  } = {}
): ResultadoVigenciaAcreditacionExterna => {
  const diasAviso = opciones.diasAviso ?? 30;

  if (
    !Number.isSafeInteger(diasAviso) ||
    diasAviso < 0 ||
    diasAviso > 365
  ) {
    throw new Error(
      'El plazo de aviso debe estar entre 0 y 365 días.'
    );
  }

  const fechaActual = obtenerFechaActualChile(
    opciones.instante ?? new Date()
  );

  const fechaVencimiento = datos.fechaVencimiento;

  if (
    datos.estado !== 'aprobado' &&
    datos.estado !== 'vencido'
  ) {
    return {
      clasificacion: 'no_aplica',
      fechaActual,
      fechaVencimiento,
      diasRestantes: null,
    };
  }

  if (fechaVencimiento === null) {
    return {
      clasificacion: 'no_aplica',
      fechaActual,
      fechaVencimiento,
      diasRestantes: null,
    };
  }

  const diasRestantes =
    convertirFechaADiasUTC(fechaVencimiento) -
    convertirFechaADiasUTC(fechaActual);

  let clasificacion: ClasificacionVigenciaExterna;

  if (datos.estado === 'vencido' || diasRestantes < 0) {
    clasificacion = 'vencido';
  } else if (diasRestantes <= diasAviso) {
    clasificacion = 'proximo_a_vencer';
  } else {
    clasificacion = 'vigente';
  }

  return {
    clasificacion,
    fechaActual,
    fechaVencimiento,
    diasRestantes,
  };
};
