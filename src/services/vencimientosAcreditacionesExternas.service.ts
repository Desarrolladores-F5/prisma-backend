// src/services/vencimientosAcreditacionesExternas.service.ts

import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../models';

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

export interface SolicitudVencimientoAcreditacionExterna {
  acreditacionId: number;
  instante?: Date;

  // Uso interno del backend.
  // El llamador administra una transacción externa.
  transaction?: Transaction;
}

export interface ResultadoVencimientoAcreditacionExterna {
  acreditacionId: number;
  fechaActual: string;
  actualizada: boolean;
}

const ZONA_HORARIA = 'America/Santiago';
const MILISEGUNDOS_DIA = 24 * 60 * 60 * 1000;

const formatoFechaChile = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Obtiene la fecha calendario de Chile.
 *
 * No depende de la zona horaria de MySQL
 * ni de la configuración del servidor.
 */
export const obtenerFechaActualChile = (
  instante: Date = new Date()
): string => {
  if (
    !(instante instanceof Date) ||
    Number.isNaN(instante.getTime())
  ) {
    throw new Error('Instante de referencia inválido.');
  }

  const partes = formatoFechaChile.formatToParts(instante);

  const obtener = (tipo: string): string => {
    const parte = partes.find(
      item => item.type === tipo
    );

    if (!parte) {
      throw new Error(
        'No se pudo obtener la fecha de Chile.'
      );
    }

    return parte.value;
  };

  return [
    obtener('year'),
    obtener('month'),
    obtener('day'),
  ].join('-');
};

const convertirFechaADiasUTC = (
  fecha: string
): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error(
      'Fecha de vencimiento inválida.'
    );
  }

  const fechaUTC = new Date(
    `${fecha}T00:00:00.000Z`
  );

  if (
    Number.isNaN(fechaUTC.getTime()) ||
    fechaUTC.toISOString().slice(0, 10) !== fecha
  ) {
    throw new Error(
      'Fecha de vencimiento inválida.'
    );
  }

  return Math.floor(
    fechaUTC.getTime() / MILISEGUNDOS_DIA
  );
};

/**
 * Clasifica la vigencia documental.
 *
 * Función pura:
 * - No escribe en MySQL.
 * - No genera notificaciones.
 * - No cambia estados.
 *
 * Una acreditación que vence hoy sigue vigente
 * durante toda la fecha calendario de Chile.
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

  if (
    datos.estado === 'vencido' ||
    diasRestantes < 0
  ) {
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

/**
 * Marca como vencida una acreditación aprobada
 * cuya fecha de vencimiento es anterior a hoy.
 *
 * Protecciones:
 *
 * - Solo recibe un identificador interno válido.
 * - Calcula la fecha usando America/Santiago.
 * - Solo modifica el estado 'aprobado'.
 * - No modifica acreditaciones sin vencimiento.
 * - No modifica acreditaciones que vencen hoy.
 * - Conserva el revisor, observaciones y fechas.
 * - Utiliza un UPDATE condicional atómico.
 * - Una ejecución repetida no cambia nuevamente
 *   una acreditación que ya está vencida.
 *
 * No genera notificaciones todavía.
 *
 * Si recibe una transacción, el llamador
 * administra su COMMIT o ROLLBACK.
 *
 * Si no la recibe, Sequelize administra
 * una transacción propia.
 */
export const marcarAcreditacionExternaVencida = async ({
  acreditacionId,
  instante,
  transaction: transaccionExterna,
}: SolicitudVencimientoAcreditacionExterna): Promise<
  ResultadoVencimientoAcreditacionExterna
> => {
  if (!idValido(acreditacionId)) {
    throw new Error(
      'Identificador de acreditación inválido.'
    );
  }

  const fechaActual = obtenerFechaActualChile(
    instante ?? new Date()
  );

  const ejecutar = async (
    transaction: Transaction
  ): Promise<ResultadoVencimientoAcreditacionExterna> => {
    const [actualizadas] =
      await AcreditacionDocumentalExterna.update(
        {
          estado: 'vencido',
        },
        {
          where: {
            id: acreditacionId,
            estado: 'aprobado',
            fecha_vencimiento: {
              [Op.lt]: fechaActual,
            },
          },
          transaction,
        }
      );

    if (actualizadas > 1) {
      throw new Error(
        'Se modificaron más acreditaciones de las permitidas.'
      );
    }

    return {
      acreditacionId,
      fechaActual,
      actualizada: actualizadas === 1,
    };
  };

  if (transaccionExterna) {
    return ejecutar(transaccionExterna);
  }

  return sequelize.transaction(ejecutar);
};
