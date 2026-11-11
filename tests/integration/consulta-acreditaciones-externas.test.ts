// tests/integration/consulta-acreditaciones-externas.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - consulta de acreditaciones externas', () => {
  it('valida mandante, contratista, aislamiento, paginación y ROLLBACK', async () => {
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

    const {
      sequelize,
      Usuario,
      UsuarioEmpresaExterna,
      ContratoExterno,
      Documento,
      AcreditacionDocumentalExterna,
    } = await import('../../src/models');

    const {
      obtenerAcreditacionesExternasContrato,
    } = await import(
      '../../src/services/consultaAcreditacionesExternas.service'
    );

    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

    const contratosIds: number[] = [];
    const acreditacionesIds: number[] = [];
    const usuariosIds: number[] = [];

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
            'BLOQUEADO: la transacción no utiliza la base de pruebas.'
          );
        }

        console.log('✅ Base MySQL aislada verificada.');

        const crearUsuario = async (tipo: string) => {
          const usuario = await Usuario.create(
            {
              rut: `TEST-CONS-${tipo}-${sufijo}`,
              nombre: 'Usuario',
              apellido: 'Integracion',
              correo: `consulta-${tipo}-${sufijo}@example.invalid`,
              rol_id: 3,
              contraseña_hash:
                'CREDENCIAL_NO_UTILIZABLE_SOLO_TEST',
              salt: 'SALT_SOLO_TEST',
              activo: true,
            },
            { transaction }
          );

          usuariosIds.push(usuario.id);
          return usuario;
        };

        const contratista = await crearUsuario('contratista');
        const tercero = await crearUsuario('tercero');

        await UsuarioEmpresaExterna.create(
          {
            usuario_id: contratista.id,
            empresa_id: 3,
            perfil: 'administrador_externo',
            activo: true,
          },
          { transaction }
        );

        const crearContrato = async (nombre: string) => {
          const contrato = await ContratoExterno.create(
            {
              mandante_empresa_id: 1,
              contratista_empresa_id: 3,
              faena_id: 3,
              nombre: `${nombre} ${sufijo}`,
              estado: 'pendiente',
            },
            { transaction }
          );

          contratosIds.push(contrato.id);
          return contrato;
        };

        const contratoPrincipal =
          await crearContrato('Contrato consulta principal');

        const contratoAjeno =
          await crearContrato('Contrato consulta separado');

        const documento = await Documento.create(
          {
            nombre: `Documento consulta ${sufijo}`,
            tipo: 'acreditacion_prueba',
            url: '/pruebas/documento-consulta-ficticio.pdf',
            version: '1.0',
            empresa_id: 3,
          },
          { transaction }
        );

        const crearRequisito = async (contratoId: number) => {
          const [requisitoId] = await sequelize.query(
            `INSERT INTO requisitos_documentales_externos
              (
                contrato_id,
                nombre,
                destinatario,
                obligatorio,
                periodicidad,
                activo
              )
             VALUES
              (
                :contratoId,
                :nombre,
                'empresa',
                1,
                'unica',
                1
              )`,
            {
              replacements: {
                contratoId,
                nombre: `Requisito consulta ${sufijo}`,
              },
              type: QueryTypes.INSERT,
              transaction,
            }
          );

          return requisitoId;
        };

        const requisitoPrincipal =
          await crearRequisito(contratoPrincipal.id);

        const requisitoAjeno =
          await crearRequisito(contratoAjeno.id);

        const crearAcreditacion = async (
          contratoId: number,
          requisitoId: number
        ) => {
          const acreditacion =
            await AcreditacionDocumentalExterna.create(
              {
                contrato_id: contratoId,
                requisito_id: requisitoId,
                documento_id: documento.id,
                presentado_por: contratista.id,
                estado: 'pendiente',
              },
              { transaction }
            );

          acreditacionesIds.push(acreditacion.id);
          return acreditacion;
        };

        await crearAcreditacion(
          contratoPrincipal.id,
          requisitoPrincipal
        );

        await crearAcreditacion(
          contratoPrincipal.id,
          requisitoPrincipal
        );

        const acreditacionOtroContrato =
          await crearAcreditacion(
            contratoAjeno.id,
            requisitoAjeno
          );

        // La mandante puede consultar su contrato.
        const consultaMandante =
          await obtenerAcreditacionesExternasContrato({
            usuarioId: 2,
            contratoId: contratoPrincipal.id,
            pagina: 1,
            limite: 20,
            transaction,
          });

        expect(consultaMandante.tipoAcceso).toBe('mandante');
        expect(consultaMandante.total).toBe(2);
        expect(consultaMandante.acreditaciones).toHaveLength(2);

        expect(
          consultaMandante.acreditaciones.every(
            item => item.contrato_id === contratoPrincipal.id
          )
        ).toBe(true);

        expect(
          consultaMandante.acreditaciones.some(
            item => item.id === acreditacionOtroContrato.id
          )
        ).toBe(false);

        console.log('✅ Consulta de mandante verificada.');

        // El administrador de la contratista también puede consultar.
        const consultaContratista =
          await obtenerAcreditacionesExternasContrato({
            usuarioId: contratista.id,
            contratoId: contratoPrincipal.id,
            transaction,
          });

        expect(consultaContratista.tipoAcceso).toBe(
          'contratista'
        );

        expect(consultaContratista.total).toBe(2);

        console.log('✅ Consulta de contratista verificada.');

        // Un tercero sin vinculación no puede consultar.
        await expect(
          obtenerAcreditacionesExternasContrato({
            usuarioId: tercero.id,
            contratoId: contratoPrincipal.id,
            transaction,
          })
        ).rejects.toMatchObject({
          estadoHttp: 403,
        });

        console.log('✅ Usuario ajeno rechazado.');

        // Paginación real sobre la base aislada.
        const primeraPagina =
          await obtenerAcreditacionesExternasContrato({
            usuarioId: 2,
            contratoId: contratoPrincipal.id,
            pagina: 1,
            limite: 1,
            transaction,
          });

        const segundaPagina =
          await obtenerAcreditacionesExternasContrato({
            usuarioId: 2,
            contratoId: contratoPrincipal.id,
            pagina: 2,
            limite: 1,
            transaction,
          });

        expect(primeraPagina.total).toBe(2);
        expect(primeraPagina.totalPaginas).toBe(2);
        expect(primeraPagina.acreditaciones).toHaveLength(1);
        expect(segundaPagina.acreditaciones).toHaveLength(1);

        expect(
          primeraPagina.acreditaciones[0].id
        ).not.toBe(
          segundaPagina.acreditaciones[0].id
        );

        console.log('✅ Paginación real verificada.');
      } finally {
        if (!transaction.finished) {
          await transaction.rollback();
          console.log('✅ ROLLBACK ejecutado.');
        }
      }

      // Confirmar que desaparecieron todos los registros
      // ficticios identificados por esta prueba.
      for (const id of acreditacionesIds) {
        expect(
          await AcreditacionDocumentalExterna.findByPk(id)
        ).toBeNull();
      }

      for (const id of contratosIds) {
        expect(
          await ContratoExterno.findByPk(id)
        ).toBeNull();
      }

      for (const id of usuariosIds) {
        expect(
          await Usuario.findByPk(id)
        ).toBeNull();
      }

      console.log('✅ Cero registros ficticios residuales.');
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
