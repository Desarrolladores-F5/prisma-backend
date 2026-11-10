// tests/integration/contratos-externos.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - contratos externos', () => {
  it('crea un contrato autorizado y revierte sus datos', async () => {
    if (process.env.DB_NAME !== BASE_PERMITIDA) {
      throw new Error('BLOQUEADO: base de datos no autorizada.');
    }

    if (
      !['localhost', '127.0.0.1', '::1'].includes(
        process.env.DB_HOST ?? ''
      )
    ) {
      throw new Error('BLOQUEADO: se requiere MySQL local.');
    }

    const { sequelize, ContratoExterno } =
      await import('../../src/models');

    const { crearContratoExterno } =
      await import('../../src/services/contratosExternos.service');

    const identificador = randomUUID().replace(/-/g, '');
    const nombre = `Contrato prueba rollback ${identificador}`;

    let contratoId: number | undefined;

    try {
      const transaction = await sequelize.transaction();

      try {
        const bases = await sequelize.query<{ nombre: string }>(
          'SELECT DATABASE() AS nombre',
          {
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        if (bases[0]?.nombre !== BASE_PERMITIDA) {
          throw new Error(
            'BLOQUEADO: conexión fuera de la base de pruebas.'
          );
        }

        const contrato = await crearContratoExterno({
          administradorId: 2,
          contratistaEmpresaId: 3,
          faenaId: 3,
          nombre,
          numeroContrato: `TEST-${identificador.slice(0, 12)}`,
          fechaInicio: '2026-11-10',
          fechaTermino: '2026-12-10',
          transaction,
        });

        contratoId = contrato.id;

        expect(contrato.mandante_empresa_id).toBe(1);
        expect(contrato.contratista_empresa_id).toBe(3);
        expect(contrato.faena_id).toBe(3);
        expect(contrato.estado).toBe('pendiente');

        const guardado = await ContratoExterno.findByPk(
          contrato.id,
          { transaction }
        );

        expect(guardado).not.toBeNull();
        expect(guardado?.nombre).toBe(nombre);

        console.log(
          '✅ Contrato creado dentro de la transacción aislada.'
        );
      } finally {
        if (!transaction.finished) {
          await transaction.rollback();
          console.log('✅ ROLLBACK ejecutado.');
        }
      }

      expect(contratoId).toBeDefined();

      const residuo = await ContratoExterno.findByPk(contratoId!);

      expect(residuo).toBeNull();

      console.log(
        '✅ Verificado: el contrato ficticio no permanece en MySQL.'
      );
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
