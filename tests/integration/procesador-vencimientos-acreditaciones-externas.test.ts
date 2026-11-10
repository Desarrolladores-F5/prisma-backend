// tests/integration/procesador-vencimientos-acreditaciones-externas.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Op, QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - procesador de acreditaciones externas', () => {
  it('procesa vencimientos, genera alertas y revierte todo', async () => {
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
      Notificacion,
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
      procesarVencimientosAcreditacionesExternas,
    } = await import(
      '../../src/services/procesadorVencimientosAcreditacionesExternas.service'
    );

    const instante = new Date('2026-11-10T15:00:00.000Z');
    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

    let transaction:
      Awaited<ReturnType<typeof sequelize.transaction>> | undefined;

    let ids: number[] = [];
    let claves: string[] = [];

    try {
      transaction = await sequelize.transaction();

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
            'BLOQUEADO: conexión fuera de la base de integración.'
          );
        }

        console.log('Base aislada verificada:', bases[0].nombre);

        const presentador = await Usuario.create(
          {
            rut: 'TEST-PROC-' + sufijo,
            nombre: 'Usuario',
            apellido: 'ProcesadorTest',
            correo: 'procesador-' + sufijo + '@example.invalid',
            rol_id: 3,
            contraseña_hash: 'CREDENCIAL_NO_UTILIZABLE_SOLO_TEST',
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

        const contrato = await ContratoExterno.create(
          {
            mandante_empresa_id: 1,
            contratista_empresa_id: 3,
            faena_id: 3,
            nombre: 'Contrato procesador ficticio ' + sufijo,
            estado: 'pendiente',
          },
          { transaction }
        );

        const [requisitoId] = await sequelize.query(
          `INSERT INTO requisitos_documentales_externos
             (contrato_id, nombre, destinatario,
              obligatorio, periodicidad, activo)
           VALUES
             (:contratoId, :nombre, 'empresa', 1, 'unica', 1)`,
          {
            replacements: {
              contratoId: contrato.id,
              nombre: 'Requisito procesador ' + sufijo,
            },
            type: QueryTypes.INSERT,
            transaction,
          }
        );

        const documento = await Documento.create(
          {
            nombre: 'Documento procesador ' + sufijo,
            tipo: 'acreditacion_prueba',
            url: '/pruebas/procesador-ficticio.pdf',
            version: '1.0',
            empresa_id: 3,
          },
          { transaction }
        );

        const presentar = (fechaVencimiento: string) =>
          registrarAcreditacionDocumentalExterna({
            administradorId: presentador.id,
            contratoId: contrato.id,
            requisitoId,
            documentoId: documento.id,
            fechaEmision: '2026-01-01',
            fechaVencimiento,
            transaction: transaction!,
          });

        const aprobar = async (acreditacionId: number) => {
          await revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId,
            accion: 'iniciar_revision',
            transaction: transaction!,
          });

          await revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId,
            accion: 'aprobar',
            observaciones: 'Aprobación ficticia del procesador.',
            transaction: transaction!,
          });
        };

        // Acreditación vencida: debe cambiar su estado.
        const vencida = await presentar('2026-11-09');
        await aprobar(vencida.id);

        // Acreditación próxima: debe conservar aprobación.
        const proxima = await presentar('2026-11-20');
        await aprobar(proxima.id);

        // Acreditación pendiente: no debe ser procesada.
        const pendiente = await presentar('2026-11-09');

        // Acreditación futura: fuera del plazo de aviso.
        const futura = await presentar('2027-01-20');
        await aprobar(futura.id);

        ids = [
          vencida.id,
          proxima.id,
          pendiente.id,
          futura.id,
        ];

        claves = [
          `alerta_vencimiento_externo:vencido:${vencida.id}:mandante`,
          `alerta_vencimiento_externo:vencido:${vencida.id}:contratista`,
          `alerta_vencimiento_externo:proximo:${proxima.id}:mandante`,
          `alerta_vencimiento_externo:proximo:${proxima.id}:contratista`,
        ];

        const opciones = {
          instante,
          diasAviso: 30,
          tamanoLote: 1,
          maximoRegistros: 1000,
          transaction,
        };

        // ESCENARIO 1: simulación sin modificaciones.
        const simulacion =
          await procesarVencimientosAcreditacionesExternas({
            ...opciones,
            modo: 'simulacion',
          });

        expect(simulacion.errores).toHaveLength(0);
        expect(simulacion.vencimientosDetectados)
          .toBeGreaterThanOrEqual(1);
        expect(simulacion.proximasAVencer)
          .toBeGreaterThanOrEqual(1);
        expect(simulacion.estadosActualizados).toBe(0);
        expect(simulacion.notificacionesTotales).toBe(0);

        const antes =
          await AcreditacionDocumentalExterna.findByPk(
            vencida.id,
            { transaction }
          );

        expect(antes?.estado).toBe('aprobado');

        // ESCENARIO 2: escritura con SAVEPOINT por registro.
        const primera =
          await procesarVencimientosAcreditacionesExternas({
            ...opciones,
            modo: 'escritura',
          });

        expect(primera.errores).toHaveLength(0);
        expect(primera.estadosActualizados)
          .toBeGreaterThanOrEqual(1);
        expect(primera.notificacionesMandante)
          .toBeGreaterThanOrEqual(2);
        expect(primera.notificacionesContratista)
          .toBeGreaterThanOrEqual(2);

        const [estadoVencida, estadoProxima, estadoPendiente, estadoFutura] =
          await Promise.all(
            ids.map(id =>
              AcreditacionDocumentalExterna.findByPk(
                id,
                { transaction }
              )
            )
          );

        expect(estadoVencida?.estado).toBe('vencido');
        expect(estadoVencida?.revisado_por).toBe(2);
        expect(estadoVencida?.observaciones)
          .toBe('Aprobación ficticia del procesador.');

        expect(estadoProxima?.estado).toBe('aprobado');
        expect(estadoPendiente?.estado).toBe('pendiente');
        expect(estadoFutura?.estado).toBe('aprobado');

        const avisos = await Notificacion.findAll({
          where: {
            clave_evento: {
              [Op.in]: claves,
            },
          },
          transaction,
        });

        expect(avisos.length).toBeGreaterThanOrEqual(4);

        // Contratista: únicamente el usuario vinculado.
        const avisosContratista = avisos.filter(
          aviso => aviso.clave_evento?.endsWith(':contratista')
        );

        expect(avisosContratista).toHaveLength(2);
        expect(
          avisosContratista.every(
            aviso => aviso.usuario_id === presentador.id
          )
        ).toBe(true);

        expect(
          avisosContratista.every(
            aviso => aviso.faena_id == null
          )
        ).toBe(true);

        // ESCENARIO 3: reejecutar no crea duplicados.
        const segunda =
          await procesarVencimientosAcreditacionesExternas({
            ...opciones,
            modo: 'escritura',
          });

        expect(segunda.errores).toHaveLength(0);
        expect(segunda.estadosActualizados).toBe(0);
        expect(segunda.notificacionesTotales).toBe(0);

        const cantidadFinal = await Notificacion.count({
          where: {
            clave_evento: {
              [Op.in]: claves,
            },
          },
          transaction,
        });

        expect(cantidadFinal).toBe(avisos.length);

        console.log(
          'Procesador validado: simulación, lotes, SAVEPOINT, ' +
          'vencimientos, alertas e idempotencia.'
        );
      } finally {
        if (transaction && !transaction.finished) {
          await transaction.rollback();
          console.log('ROLLBACK general ejecutado.');
        }
      }

      // ESCENARIO 4: cero avisos residuales después del ROLLBACK.
      const residuos = await Notificacion.count({
        where: {
          clave_evento: {
            [Op.in]: claves,
          },
        },
      });

      expect(residuos).toBe(0);

      const acreditacionesRestantes =
        await AcreditacionDocumentalExterna.count({
          where: {
            id: {
              [Op.in]: ids,
            },
          },
        });

      expect(acreditacionesRestantes).toBe(0);

      console.log(
        'Limpieza confirmada: cero alertas y acreditaciones ficticias.'
      );
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
