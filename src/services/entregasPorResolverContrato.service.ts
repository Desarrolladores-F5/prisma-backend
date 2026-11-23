// src/services/entregasPorResolverContrato.service.ts

import { QueryTypes } from 'sequelize';

import { sequelize } from '../models';

import {
  obtenerEmpresaAdministrador,
} from './asignacionDocumental.service';

export interface EntregasPorResolverContrato {
  contrato_id: number;
  total: number;
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Obtiene las entregas por resolver agrupadas por contrato.
 *
 * Mantiene los mismos criterios del contador general:
 * - Contratos de la mandante autenticada.
 * - Empresas mandante y contratista activas.
 * - Requisitos activos dirigidos a empresas.
 * - Última entrega de cada requisito documental.
 * - Estados pendiente o en_revision.
 *
 * No incluye versiones históricas anteriores.
 * No recibe identificadores de mandante desde el frontend.
 */
export async function obtenerEntregasPorResolverContrato(
  administradorId: number
): Promise<EntregasPorResolverContrato[]> {
  if (!idValido(administradorId)) {
    throw new Error('Administrador inválido.');
  }

  const mandanteId = await obtenerEmpresaAdministrador(
    administradorId
  );

  const filas = await sequelize.query<{
    contrato_id: number | string;
    total: number | string;
  }>(
    [
      'SELECT c.id AS contrato_id, COUNT(*) AS total',
      'FROM contratos_externos c',
      'JOIN empresas m ON m.id = c.mandante_empresa_id AND m.activo = 1',
      'JOIN empresas e ON e.id = c.contratista_empresa_id AND e.activo = 1',
      'JOIN requisitos_documentales_externos r ON r.contrato_id = c.id',
      'JOIN acreditaciones_documentales_externas a ON a.id = (',
      '  SELECT ultima.id',
      '  FROM acreditaciones_documentales_externas ultima',
      '  WHERE ultima.contrato_id = c.id AND ultima.requisito_id = r.id',
      '    AND ultima.contrato_trabajador_id IS NULL',
      '  ORDER BY ultima.fecha_presentacion DESC, ultima.id DESC',
      '  LIMIT 1',
      ')',
      'WHERE c.mandante_empresa_id = :mandanteId',
      "  AND r.activo = 1 AND r.destinatario = 'empresa'",
      "  AND a.estado IN ('pendiente', 'en_revision')",
      'GROUP BY c.id',
      'ORDER BY c.id DESC',
    ].join('\n'),
    {
      replacements: { mandanteId },
      type: QueryTypes.SELECT,
    }
  );

  return filas.map(fila => {
    const contratoId = Number(fila.contrato_id);
    const total = Number(fila.total);

    if (
      !idValido(contratoId) ||
      !Number.isSafeInteger(total) ||
      total < 0
    ) {
      throw new Error(
        'El resumen de entregas contiene valores inválidos.'
      );
    }

    return {
      contrato_id: contratoId,
      total,
    };
  });
}
