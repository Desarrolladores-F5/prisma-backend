// tests/integration/consulta-contratos-externos.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - consulta de contratos externos', () => {
  it('consulta únicamente contratos de la mandante y ejecuta ROLLBACK', async () => {
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

    const { obtenerContratosExternosMandante } =
      await import(
        '../../src/services/consultaContratosExternos.service'
      );

    const nombre = `Consulta externa test ${randomUUID()}`;

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
          throw new Error('BLOQUEADO: base MySQL incorrecta.');
        }

        const contrato = await ContratoExterno.create(
          {
            mandante_empresa_id: 1,
            contratista_empresa_id: 3,
            faena_id: 3,
            nombre,
            estado: 'pendiente',
          },
          { transaction }
        );

        contratoId = contrato.id;

        const contratos = await obtenerContratosExternosMandante({
          administradorId: 2,
          transaction,
        });

        expect(contratos.some(item => item.id === contratoId))
          .toBe(true);

        expect(
          contratos.every(item => item.mandante_empresa_id === 1)
        ).toBe(true);

        console.log(
          '✅ Consulta de contratos de la mandante verificada.'
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
        '✅ Sin contratos ficticios residuales.'
      );
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
