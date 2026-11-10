// tests/integration/vencimientos-acreditaciones-externas.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - vencimientos de acreditaciones externas', () => {
  it('vence solo acreditaciones aprobadas y conserva su historial', async () => {
    if (process.env.DB_NAME !== BASE_PERMITIDA) {
      throw new Error(
        'BLOQUEADO: DB_NAME debe ser prisma_test_empresas_externas.'
      );
    }

    if (
      !['localhost', '127.0.0.1', '::1'].includes(
        process.env.DB_HOST || 'localhost'
      )
    ) {
      throw new Error(
        'BLOQUEADO: esta integración solamente permite MySQL local.'
      );
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
      registrarAcreditacionDocumentalExterna,
    } = await import(
      '../../src/services/registroAcreditacionDocumentalExterna.service'
    );

    const {
      revisarAcreditacionDocumentalExterna,
    } = await import(
      '../../src/services/revisionAcreditacionDocumentalExterna.service'
    );

    const {
      marcarAcreditacionExternaVencida,
      obtenerFechaActualChile,
    } = await import(
      '../../src/services/vencimientosAcreditacionesExternas.service'
    );

    // Fecha fija: garantiza resultados reproducibles.
    // En Chile corresponde al 10 de noviembre de 2026.
    const instante = new Date('2026-11-10T15:00:00.000Z');

    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

    try {
      const transaction = await sequelize.transaction();

      try {
        // Verificar la base de la conexión transaccional
        // antes de realizar cualquier escritura.
        const bases = await sequelize.query<{ nombre: string }>(
          'SELECT DATABASE() AS nombre',
          {
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        if (bases[0]?.nombre !== BASE_PERMITIDA) {
          throw new Error(
            'BLOQUEADO: conexión fuera de la base de integración.'
          );
        }

        console.log(
          'Base de integración verificada:',
          bases[0].nombre
        );

        expect(obtenerFechaActualChile(instante))
          .toBe('2026-11-10');

        // Crear usuario ficticio sin credenciales utilizables.
        const presentador = await Usuario.create(
          {
            rut: 'TEST-VENC-' + sufijo,
            nombre: 'Usuario',
            apellido: 'Vencimientos',
            correo:
              'vencimientos-' + sufijo + '@example.invalid',
            rol_id: 3,
            contraseña_hash:
              'CREDENCIAL_NO_UTILIZABLE_SOLO_TEST',
            salt: 'SALT_SOLO_TEST',
            activo: true,
          },
          { transaction }
        );

        await UsuarioEmpresaExterna.create(
          {
            usuario_id: presentador.id,
            empresa_id: 3,
            perfil: 'administrador_externo',
            activo: true,
          },
          { transaction }
        );

        // Contrato ficticio entre mandante y contratista.
        const contrato = await ContratoExterno.create(
          {
            mandante_empresa_id: 1,
            contratista_empresa_id: 3,
            faena_id: 3,
            nombre:
              'Contrato ficticio vencimientos ' + sufijo,
            estado: 'pendiente',
          },
          { transaction }
        );

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
           VALUES (
              :contratoId,
              :nombre,
              'empresa',
              1,
              'unica',
              1
            )`,
          {
            replacements: {
              contratoId: contrato.id,
              nombre: 'Requisito vencimientos ' + sufijo,
            },
            type: QueryTypes.INSERT,
            transaction,
          }
        );

        const documento = await Documento.create(
          {
            nombre:
              'Documento ficticio vencimientos ' + sufijo,
            tipo: 'acreditacion_prueba',
            url: '/pruebas/vencimientos-ficticio.pdf',
            version: '1.0',
            empresa_id: 3,
          },
          { transaction }
        );

        // Cada presentación es una acreditación independiente.
        const presentar = (fechaVencimiento: string) =>
          registrarAcreditacionDocumentalExterna({
            administradorId: presentador.id,
            contratoId: contrato.id,
            requisitoId,
            documentoId: documento.id,
            fechaEmision: '2026-01-01',
            fechaVencimiento,
            transaction,
          });

        const aprobar = async (acreditacionId: number) => {
          await revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId,
            accion: 'iniciar_revision',
            transaction,
          });

          return revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId,
            accion: 'aprobar',
            observaciones:
              'Documento aprobado en prueba de integración.',
            transaction,
          });
        };

        // ESCENARIO 1: aprobada, venció ayer.
        const vencida = await presentar('2026-11-09');
        await aprobar(vencida.id);

        const antes = await AcreditacionDocumentalExterna.findByPk(
          vencida.id,
          { transaction }
        );

        expect(antes?.estado).toBe('aprobado');
        expect(antes?.revisado_por).toBe(2);
        expect(antes?.fecha_revision).not.toBeNull();

        const historialOriginal = {
          revisadoPor: antes?.revisado_por,
          fechaRevision: antes?.fecha_revision?.getTime(),
          observaciones: antes?.observaciones,
          fechaVencimiento: antes?.fecha_vencimiento,
        };

        const primeraTransicion =
          await marcarAcreditacionExternaVencida({
            acreditacionId: vencida.id,
            instante,
            transaction,
          });

        expect(primeraTransicion.actualizada).toBe(true);
        expect(primeraTransicion.fechaActual)
          .toBe('2026-11-10');

        const despues =
          await AcreditacionDocumentalExterna.findByPk(
            vencida.id,
            { transaction }
          );

        expect(despues?.estado).toBe('vencido');

        // El vencimiento no debe borrar la aprobación.
        expect(despues?.revisado_por)
          .toBe(historialOriginal.revisadoPor);

        expect(despues?.fecha_revision?.getTime())
          .toBe(historialOriginal.fechaRevision);

        expect(despues?.observaciones)
          .toBe(historialOriginal.observaciones);

        expect(despues?.fecha_vencimiento)
          .toBe(historialOriginal.fechaVencimiento);

        // ESCENARIO 2: ejecutar nuevamente no altera nada.
        const segundaTransicion =
          await marcarAcreditacionExternaVencida({
            acreditacionId: vencida.id,
            instante,
            transaction,
          });

        expect(segundaTransicion.actualizada).toBe(false);

        // ESCENARIO 3: vence hoy; todavía está vigente.
        const venceHoy = await presentar('2026-11-10');
        await aprobar(venceHoy.id);

        const resultadoHoy =
          await marcarAcreditacionExternaVencida({
            acreditacionId: venceHoy.id,
            instante,
            transaction,
          });

        expect(resultadoHoy.actualizada).toBe(false);

        const registroHoy =
          await AcreditacionDocumentalExterna.findByPk(
            venceHoy.id,
            { transaction }
          );

        expect(registroHoy?.estado).toBe('aprobado');

        // ESCENARIO 4: vence mañana.
        const venceManana = await presentar('2026-11-11');
        await aprobar(venceManana.id);

        const resultadoManana =
          await marcarAcreditacionExternaVencida({
            acreditacionId: venceManana.id,
            instante,
            transaction,
          });

        expect(resultadoManana.actualizada).toBe(false);

        const registroManana =
          await AcreditacionDocumentalExterna.findByPk(
            venceManana.id,
            { transaction }
          );

        expect(registroManana?.estado).toBe('aprobado');

        // ESCENARIO 5: presentación pendiente ya caducada.
        // No se debe saltar el proceso de revisión.
        const pendiente = await presentar('2026-11-09');

        const resultadoPendiente =
          await marcarAcreditacionExternaVencida({
            acreditacionId: pendiente.id,
            instante,
            transaction,
          });

        expect(resultadoPendiente.actualizada).toBe(false);

        const registroPendiente =
          await AcreditacionDocumentalExterna.findByPk(
            pendiente.id,
            { transaction }
          );

        expect(registroPendiente?.estado).toBe('pendiente');

        console.log(
          'Integración verificada: vencimiento, vigencia, ' +
          'idempotencia e historial de revisión.'
        );
      } finally {
        // Nunca confirmar registros ficticios.
        await transaction.rollback();

        console.log(
          'ROLLBACK ejecutado: datos ficticios revertidos.'
        );
      }
    } finally {
      await sequelize.close();
    }
  }, 45000);
});
