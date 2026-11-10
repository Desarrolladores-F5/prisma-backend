// src/services/procesadorVencimientosAcreditacionesExternas.service.ts

import {
  Op,
  QueryTypes,
} from 'sequelize';

import type {
  Transaction,
} from 'sequelize';

import {
  sequelize,
  AcreditacionDocumentalExterna,
} from '../models';

import {
  clasificarVigenciaAcreditacionExterna,
  marcarAcreditacionExternaVencida,
  obtenerFechaActualChile,
} from './vencimientosAcreditacionesExternas.service';

import {
  generarAlertasAcreditacionExterna,
} from './alertasAcreditacionesExternas.service';

export type ModoProcesamientoAcreditacionesExternas =
  | 'simulacion'
  | 'escritura';

export interface OpcionesProcesamientoAcreditacionesExternas {
  modo?: ModoProcesamientoAcreditacionesExternas;
  instante?: Date;
  diasAviso?: number;
  tamanoLote?: number;
  maximoRegistros?: number;

  /**
   * Transacción administrada por el llamador.
   *
   * Permite ejecutar integraciones con ROLLBACK
   * y mantener los datos ficticios aislados.
   */
  transaction?: Transaction;
}

export interface ErrorProcesamientoAcreditacionExterna {
  acreditacionId: number;
  mensaje: string;
}

export interface ResumenProcesamientoAcreditacionesExternas {
  modo: ModoProcesamientoAcreditacionesExternas;
  fechaActual: string;
  fechaLimiteAviso: string;
  examinadas: number;
  vencimientosDetectados: number;
  estadosActualizados: number;
  proximasAVencer: number;
  notificacionesMandante: number;
  notificacionesContratista: number;
  notificacionesTotales: number;
  errores: ErrorProcesamientoAcreditacionExterna[];
  limiteAlcanzado: boolean;
}

const BASE_PRUEBAS = 'prisma_test_empresas_externas';

const MILISEGUNDOS_DIA =
  24 * 60 * 60 * 1000;

const enteroEnRango = (
  valor: unknown,
  minimo: number,
  maximo: number
): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor >= minimo &&
  valor <= maximo;

const agregarDiasCalendario = (
  fecha: string,
  cantidad: number
): string => {
  const instante = new Date(
    `${fecha}T00:00:00.000Z`
  );

  return new Date(
    instante.getTime() +
    cantidad * MILISEGUNDOS_DIA
  ).toISOString().slice(0, 10);
};

/**
 * Comprueba el entorno antes de permitir escrituras.
 *
 * Por ahora únicamente se autoriza la base
 * local de integración de Empresas Externas.
 *
 * Si existe una transacción externa, la verificación
 * se realiza utilizando esa misma conexión.
 *
 * Nunca autoriza escrituras sobre Prisma.
 */
const verificarBaseDeEscritura = async (
  transaction?: Transaction
): Promise<void> => {
  if (
    process.env.DB_NAME !== BASE_PRUEBAS ||
    !['localhost', '127.0.0.1', '::1'].includes(
      process.env.DB_HOST ?? ''
    )
  ) {
    throw new Error(
      'BLOQUEADO: el procesamiento con escritura ' +
      'solo está autorizado para la base local ' +
      BASE_PRUEBAS + '.'
    );
  }

  const registros = await sequelize.query<{
    nombre: string | null;
  }>(
    'SELECT DATABASE() AS nombre',
    {
      type: QueryTypes.SELECT,
      transaction,
    }
  );

  if (registros[0]?.nombre !== BASE_PRUEBAS) {
    throw new Error(
      'BLOQUEADO: la conexión real no corresponde ' +
      'a la base de integración autorizada.'
    );
  }
};

/**
 * Procesador por lotes de acreditaciones externas.
 *
 * Características:
 *
 * - Simulación por defecto.
 * - Sin escrituras en simulación.
 * - Escritura restringida a MySQL local de pruebas.
 * - Fecha calendario de America/Santiago.
 * - Paginación ascendente por identificador.
 * - Transacción individual por acreditación.
 * - SAVEPOINT cuando existe transacción externa.
 * - Actualización condicional de vencimientos.
 * - Notificaciones con claves de evento estables.
 * - Reintentos de alertas de documentos vencidos.
 * - Continuidad ante errores individuales.
 *
 * No modifica el motor de EPP o medidas correctivas.
 * No programa tareas CRON.
 * No autoriza escrituras de producción.
 */
export const procesarVencimientosAcreditacionesExternas =
  async (
    opciones: OpcionesProcesamientoAcreditacionesExternas = {}
  ): Promise<ResumenProcesamientoAcreditacionesExternas> => {
    const {
      modo = 'simulacion',
      instante = new Date(),
      diasAviso = 30,
      tamanoLote = 100,
      maximoRegistros = 1000,
      transaction: transaccionExterna,
    } = opciones;

    if (
      modo !== 'simulacion' &&
      modo !== 'escritura'
    ) {
      throw new Error(
        'Modo de procesamiento inválido.'
      );
    }

    if (
      !enteroEnRango(diasAviso, 0, 365) ||
      !enteroEnRango(tamanoLote, 1, 200) ||
      !enteroEnRango(maximoRegistros, 1, 5000)
    ) {
      throw new Error(
        'Parámetros de procesamiento fuera de rango.'
      );
    }

    const fechaActual = obtenerFechaActualChile(
      instante
    );

    const fechaLimiteAviso =
      agregarDiasCalendario(
        fechaActual,
        diasAviso
      );

    // Validar el entorno antes de cualquier escritura.
    if (modo === 'escritura') {
      await verificarBaseDeEscritura(
        transaccionExterna
      );
    }

    const resumen: ResumenProcesamientoAcreditacionesExternas = {
      modo,
      fechaActual,
      fechaLimiteAviso,
      examinadas: 0,
      vencimientosDetectados: 0,
      estadosActualizados: 0,
      proximasAVencer: 0,
      notificacionesMandante: 0,
      notificacionesContratista: 0,
      notificacionesTotales: 0,
      errores: [],
      limiteAlcanzado: false,
    };

    let ultimoId = 0;

    while (
      resumen.examinadas < maximoRegistros
    ) {
      const cantidad = Math.min(
        tamanoLote,
        maximoRegistros - resumen.examinadas
      );

      /**
       * Consultar también documentos ya vencidos.
       *
       * Esto permite recuperar notificaciones
       * que hayan fallado anteriormente.
       *
       * La paginación por ID evita repetir
       * registros cuando cambia su estado.
       */
      const acreditaciones =
        await AcreditacionDocumentalExterna.findAll({
          attributes: [
            'id',
            'estado',
            'fecha_vencimiento',
          ],
          where: {
            id: {
              [Op.gt]: ultimoId,
            },
            [Op.or]: [
              {
                estado: 'aprobado',
                fecha_vencimiento: {
                  [Op.lte]: fechaLimiteAviso,
                },
              },
              {
                estado: 'vencido',
                fecha_vencimiento: {
                  [Op.lte]: fechaActual,
                },
              },
            ],
          },
          order: [
            ['id', 'ASC'],
          ],
          limit: cantidad,

          // Permite consultar los datos ficticios
          // creados dentro de una transacción externa.
          transaction: transaccionExterna,
        });

      if (
        acreditaciones.length === 0
      ) {
        break;
      }

      for (
        const acreditacion of acreditaciones
      ) {
        ultimoId = Number(acreditacion.id);

        resumen.examinadas++;

        try {
          const vigencia =
            clasificarVigenciaAcreditacionExterna(
              {
                estado: acreditacion.estado,
                fechaVencimiento:
                  acreditacion.fecha_vencimiento,
              },
              {
                instante,
                diasAviso,
              }
            );

          if (
            vigencia.clasificacion === 'vencido'
          ) {
            resumen.vencimientosDetectados++;
          } else if (
            vigencia.clasificacion ===
            'proximo_a_vencer'
          ) {
            resumen.proximasAVencer++;
          }

          if (
            modo === 'simulacion'
          ) {
            continue;
          }

          /**
           * Ejecutar una acreditación.
           *
           * La transición y los avisos comparten
           * la misma transacción.
           */
          const ejecutarAcreditacion = async (
            transaction: Transaction
          ) => {
            const transicion =
              await marcarAcreditacionExternaVencida({
                acreditacionId:
                  acreditacion.id,
                instante,
                transaction,
              });

            const alertas =
              await generarAlertasAcreditacionExterna({
                acreditacionId:
                  acreditacion.id,
                instante,
                diasAviso,
                transaction,
              });

            return {
              transicion,
              alertas,
            };
          };

          /**
           * Sin transacción externa:
           * Sequelize administra una transacción propia.
           *
           * Con transacción externa:
           * Sequelize crea una transacción anidada
           * mediante SAVEPOINT.
           *
           * El SAVEPOINT permite revertir solamente
           * la acreditación que falló.
           *
           * La transacción externa permanece bajo
           * responsabilidad del llamador.
           */
          const resultado = transaccionExterna
            ? await sequelize.transaction(
                {
                  transaction: transaccionExterna,
                },
                ejecutarAcreditacion
              )
            : await sequelize.transaction(
                ejecutarAcreditacion
              );

          // Contabilizar exclusivamente operaciones
          // finalizadas correctamente.
          if (
            resultado.transicion.actualizada
          ) {
            resumen.estadosActualizados++;
          }

          resumen.notificacionesMandante +=
            resultado.alertas.notificacionesMandante;

          resumen.notificacionesContratista +=
            resultado.alertas.notificacionesContratista;

          resumen.notificacionesTotales +=
            resultado.alertas.totalNotificaciones;

        } catch (error) {
          /**
           * Registrar la falla individual.
           *
           * No detener todo el procesamiento,
           * pero tampoco contabilizar escrituras
           * que no terminaron correctamente.
           */
          resumen.errores.push({
            acreditacionId:
              acreditacion.id,
            mensaje:
              error instanceof Error
                ? error.message
                : 'Error desconocido de procesamiento.',
          });
        }
      }

      if (
        acreditaciones.length < cantidad
      ) {
        break;
      }
    }

    resumen.limiteAlcanzado =
      resumen.examinadas >= maximoRegistros;

    return resumen;
  };
