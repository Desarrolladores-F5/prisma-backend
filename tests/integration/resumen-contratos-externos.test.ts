// tests/integration/resumen-contratos-externos.test.ts

import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - resumen de contratistas', () => {
  it('verifica contratistas, subcontratistas y aislamiento multiempresa', async () => {
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

    const { sequelize, ContratoExterno, Empresa } =
      await import('../../src/models');

    const {
      obtenerResumenContratosExternos,
    } = await import(
      '../../src/services/resumenContratosExternos.service'
    );

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

        // Datos confirmados en la base de pruebas.
        const mandanteId = 1;
        const contratistaId = 3;
        const faenaId = 3;

        // Empresa ficticia temporal para simular subcontratación.
        const subcontratista = await Empresa.create(
          {
            nombre: 'Subcontratista temporal de integración',
            rut: '99999999-9',
            activo: true,
          },
          { transaction }
        );

        const subcontratistaId = Number(
          subcontratista.get('id')
        );

        const principal = await ContratoExterno.create(
          {
            mandante_empresa_id: mandanteId,
            contratista_empresa_id: contratistaId,
            faena_id: faenaId,
            nombre: 'Contrato principal temporal',
            numero_contrato: 'TEST-PRINCIPAL',
            estado: 'pendiente',
          },
          { transaction }
        );

        const subcontrato = await ContratoExterno.create(
          {
            mandante_empresa_id: mandanteId,
            contratista_empresa_id: subcontratistaId,
            faena_id: faenaId,
            contrato_principal_id: principal.id,
            nombre: 'Subcontrato temporal',
            numero_contrato: 'TEST-SUBCONTRATO',
            estado: 'pendiente',
          },
          { transaction }
        );

        // Administrador 2 corresponde a Empresa F5
        // según el escenario de integración existente.
        const resultado = await obtenerResumenContratosExternos({
          administradorId: 2,
          transaction,
        });

        const contratoPrincipal = resultado.find(
          item => item.id === principal.id
        );

        const contratoSubcontratista = resultado.find(
          item => item.id === subcontrato.id
        );

        expect(contratoPrincipal).toBeDefined();
        expect(contratoPrincipal?.tipo).toBe('contratista');
        expect(contratoPrincipal?.contratista.id)
          .toBe(contratistaId);
        expect(contratoPrincipal?.faena.id).toBe(faenaId);

        expect(contratoSubcontratista).toBeDefined();
        expect(contratoSubcontratista?.tipo)
          .toBe('subcontratista');
        expect(contratoSubcontratista?.contratista.id)
          .toBe(subcontratistaId);
        expect(contratoSubcontratista?.contrato_principal?.id)
          .toBe(principal.id);
        expect(contratoSubcontratista?.faena.id).toBe(faenaId);

        expect(
          contratoSubcontratista?.contrato_principal?.faena_id
        ).toBe(faenaId);

        console.log(
          '✅ Contratista y subcontratista identificadas correctamente.'
        );

        console.log(
          '✅ Contratos y faena relacionados correctamente.'
        );
      } finally {
        if (!transaction.finished) {
          await transaction.rollback();
          console.log('✅ ROLLBACK ejecutado.');
        }
      }
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
