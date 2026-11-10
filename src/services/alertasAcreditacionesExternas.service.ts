// src/services/alertasAcreditacionesExternas.service.ts

import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';

import {
  AcreditacionDocumentalExterna,
  ContratoExterno,
  Faena,
  Usuario,
  UsuarioEmpresaExterna,
} from '../models';

import {
  crearNotificacionesAutomaticas,
} from './notificacionesAutomaticas.service';

import {
  clasificarVigenciaAcreditacionExterna,
} from './vencimientosAcreditacionesExternas.service';

export interface SolicitudAlertaAcreditacionExterna {
  acreditacionId: number;
  instante?: Date;
  diasAviso?: number;
  transaction?: Transaction;
}

export interface ResultadoAlertaAcreditacionExterna {
  acreditacionId: number;
  clasificacion: string;
  notificacionesMandante: number;
  notificacionesContratista: number;
  totalNotificaciones: number;
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Emite alertas de vigencia para una acreditación externa.
 *
 * Seguridad:
 * - Verifica la relación contrato/mandante/faena.
 * - Selecciona administradores externos de la contratista.
 * - Exige usuarios y vinculaciones activos.
 * - No realiza difusión general entre empresas.
 * - Usa claves de evento estables para evitar duplicados.
 *
 * Este servicio no modifica estados documentales.
 * La transición a 'vencido' se administra por separado.
 */
export const generarAlertasAcreditacionExterna = async ({
  acreditacionId,
  instante,
  diasAviso = 30,
  transaction,
}: SolicitudAlertaAcreditacionExterna): Promise<
  ResultadoAlertaAcreditacionExterna
> => {
  if (!idValido(acreditacionId)) {
    throw new Error(
      'Identificador de acreditación inválido.'
    );
  }

  if (
    !Number.isSafeInteger(diasAviso) ||
    diasAviso < 0 ||
    diasAviso > 365
  ) {
    throw new Error(
      'El plazo de aviso debe estar entre 0 y 365 días.'
    );
  }

  const acreditacion =
    await AcreditacionDocumentalExterna.findByPk(
      acreditacionId,
      { transaction }
    );

  if (!acreditacion) {
    throw new Error(
      'La acreditación documental no existe.'
    );
  }

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

  const resultadoBase = {
    acreditacionId,
    clasificacion: vigencia.clasificacion,
    notificacionesMandante: 0,
    notificacionesContratista: 0,
    totalNotificaciones: 0,
  };

  if (
    vigencia.clasificacion !== 'proximo_a_vencer' &&
    vigencia.clasificacion !== 'vencido'
  ) {
    return resultadoBase;
  }

  const contrato = await ContratoExterno.findByPk(
    acreditacion.contrato_id,
    { transaction }
  );

  if (!contrato) {
    throw new Error(
      'No se encontró el contrato de la acreditación.'
    );
  }

  if (
    !idValido(contrato.mandante_empresa_id) ||
    !idValido(contrato.contratista_empresa_id) ||
    !idValido(contrato.faena_id)
  ) {
    throw new Error(
      'El contrato presenta relaciones inválidas.'
    );
  }

  // No notificar contratos fuera del flujo habilitado.
  if (
    contrato.estado !== 'pendiente' &&
    contrato.estado !== 'activo'
  ) {
    return resultadoBase;
  }

  const faena = await Faena.findByPk(
    contrato.faena_id,
    { transaction }
  );

  if (
    !faena ||
    Number(faena.get('empresa_id')) !==
      contrato.mandante_empresa_id
  ) {
    throw new Error(
      'La faena no pertenece a la empresa mandante del contrato.'
    );
  }

  // Localizar vinculaciones vigentes de la contratista.
  const vinculaciones =
    await UsuarioEmpresaExterna.findAll({
      attributes: ['usuario_id'],
      where: {
        empresa_id: contrato.contratista_empresa_id,
        perfil: 'administrador_externo',
        activo: true,
      },
      transaction,
    });

  const idsVinculados = [
    ...new Set(
      vinculaciones.map(
        vinculacion => Number(vinculacion.usuario_id)
      )
    ),
  ].filter(idValido);

  // Validar que las cuentas también sigan activas.
  const usuariosExternos = idsVinculados.length > 0
    ? await Usuario.findAll({
        attributes: ['id'],
        where: {
          id: {
            [Op.in]: idsVinculados,
          },
          activo: true,
        },
        transaction,
      })
    : [];

  const destinatariosExternos = usuariosExternos.map(
    usuario => Number(usuario.id)
  );

  const esVencida =
    vigencia.clasificacion === 'vencido';

  const tipo = esVencida
    ? 'alerta_vencimiento_externo_vencido'
    : 'alerta_vencimiento_externo_proximo';

  const mensaje = esVencida
    ? (
        `La acreditación documental externa N.º ` +
        `${acreditacionId} del contrato ` +
        `«${contrato.nombre}» está vencida ` +
        `desde el ${vigencia.fechaVencimiento}.`
      )
    : (
        `La acreditación documental externa N.º ` +
        `${acreditacionId} del contrato ` +
        `«${contrato.nombre}» vence el ` +
        `${vigencia.fechaVencimiento} ` +
        `(${vigencia.diasRestantes} días restantes).`
      );

  const claveBase = [
    'alerta_vencimiento_externo',
    esVencida ? 'vencido' : 'proximo',
    acreditacionId,
  ].join(':');

  // El servicio central resuelve únicamente administradores
  // de la empresa mandante asociada a la faena.
  const notificacionesMandante =
    await crearNotificacionesAutomaticas({
      mensaje,
      tipo,
      origen: 'acreditaciones_externas',
      claveEvento: `${claveBase}:mandante`,
      roles: [1],
      faenaId: contrato.faena_id,
      transaction,
    });

  // No pasamos faenaId para destinatarios externos:
  // sus usuarios pueden pertenecer a otras faenas.
  // Sus permisos se verificaron usando la vinculación
  // activa con la empresa contratista del contrato.
  const notificacionesContratista =
    destinatariosExternos.length > 0
      ? await crearNotificacionesAutomaticas({
          mensaje,
          tipo,
          origen: 'acreditaciones_externas',
          claveEvento: `${claveBase}:contratista`,
          destinatariosIds: destinatariosExternos,
          transaction,
        })
      : 0;

  return {
    acreditacionId,
    clasificacion: vigencia.clasificacion,
    notificacionesMandante,
    notificacionesContratista,
    totalNotificaciones:
      notificacionesMandante +
      notificacionesContratista,
  };
};
