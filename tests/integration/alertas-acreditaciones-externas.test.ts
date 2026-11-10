// tests/integration/alertas-acreditaciones-externas.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Op, QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - alertas de acreditaciones externas', () => {
  it('separa destinatarios, evita duplicados y revierte las notificaciones', async () => {
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
        'BLOQUEADO: esta integración requiere MySQL local.'
      );
    }

    const {
      sequelize,
      Usuario,
      UsuarioEmpresaExterna,
      ContratoExterno,
      Documento,
      Faena,
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
      generarAlertasAcreditacionExterna,
    } = await import(
      '../../src/services/alertasAcreditacionesExternas.service'
    );

    const instante = new Date('2026-11-10T15:00:00.000Z');
    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

    let clavesCreadas: string[] = [];

    try {
      const transaction = await sequelize.transaction();

      try {
        // Prohibir escrituras antes de comprobar
        // la base de la conexión transaccional.
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
          'Base transaccional verificada:',
          bases[0].nombre
        );

        // Datos ficticios exclusivos de esta prueba.
        const presentador = await Usuario.create(
          {
            rut: 'TEST-ALERTA-' + sufijo,
            nombre: 'Administrador',
            apellido: 'ContratistaTest',
            correo: 'alerta-' + sufijo + '@example.invalid',
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

        const contrato = await ContratoExterno.create(
          {
            mandante_empresa_id: 1,
            contratista_empresa_id: 3,
            faena_id: 3,
            nombre: 'Contrato ficticio de alertas ' + sufijo,
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
              nombre: 'Requisito alerta ' + sufijo,
            },
            type: QueryTypes.INSERT,
            transaction,
          }
        );

        const documento = await Documento.create(
          {
            nombre: 'Documento de alerta ' + sufijo,
            tipo: 'acreditacion_prueba',
            url: '/pruebas/alerta-ficticia.pdf',
            version: '1.0',
            empresa_id: 3,
          },
          { transaction }
        );

        // Documento que vencerá dentro de 10 días.
        const acreditacion =
          await registrarAcreditacionDocumentalExterna({
            administradorId: presentador.id,
            contratoId: contrato.id,
            requisitoId,
            documentoId: documento.id,
            fechaEmision: '2026-01-01',
            fechaVencimiento: '2026-11-20',
            transaction,
          });

        await revisarAcreditacionDocumentalExterna({
          administradorId: 2,
          acreditacionId: acreditacion.id,
          accion: 'iniciar_revision',
          transaction,
        });

        const aprobada =
          await revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId: acreditacion.id,
            accion: 'aprobar',
            transaction,
          });

        expect(aprobada.estado).toBe('aprobado');

        const claveMandante =
          `alerta_vencimiento_externo:proximo:${acreditacion.id}:mandante`;

        const claveContratista =
          `alerta_vencimiento_externo:proximo:${acreditacion.id}:contratista`;

        clavesCreadas = [claveMandante, claveContratista];

        const generar = () =>
          generarAlertasAcreditacionExterna({
            acreditacionId: acreditacion.id,
            instante,
            transaction,
          });

        // Primera ejecución: notificaciones reales
        // dentro de la misma transacción.
        const primera = await generar();

        expect(primera.clasificacion).toBe(
          'proximo_a_vencer'
        );

        expect(primera.notificacionesMandante)
          .toBeGreaterThan(0);

        expect(primera.notificacionesContratista)
          .toBe(1);

        expect(primera.totalNotificaciones).toBe(
          primera.notificacionesMandante +
          primera.notificacionesContratista
        );

        const notificaciones = await Notificacion.findAll({
          where: {
            clave_evento: {
              [Op.in]: clavesCreadas,
            },
          },
          transaction,
        });

        expect(notificaciones.length).toBe(
          primera.totalNotificaciones
        );

        const mandante = notificaciones.filter(
          item => item.clave_evento === claveMandante
        );

        const contratista = notificaciones.filter(
          item => item.clave_evento === claveContratista
        );

        expect(mandante.length).toBe(
          primera.notificacionesMandante
        );

        expect(contratista).toHaveLength(1);

        expect(contratista[0].usuario_id).toBe(
          presentador.id
        );

        // El administrador externo no debe recibir
        // avisos asociados a la faena del mandante.
        expect(contratista[0].faena_id ?? null).toBeNull();

        expect(mandante.every(
          item => item.faena_id === contrato.faena_id
        )).toBe(true);

        // Verificar destinatarios reales del mandante.
        for (const aviso of mandante) {
          const usuario = await Usuario.findByPk(
            aviso.usuario_id,
            { transaction }
          );

          expect(usuario).not.toBeNull();
          expect(usuario?.rol_id).toBe(1);
          expect(usuario?.activo).toBe(true);

          const faenaUsuario = await Faena.findByPk(
            usuario!.faena_id,
            { transaction }
          );

          expect(
            Number(faenaUsuario?.get('empresa_id'))
          ).toBe(contrato.mandante_empresa_id);
        }

        // Ningún usuario puede recibir dos notificaciones
        // con la misma clave.
        const combinaciones = notificaciones.map(
          item => `${item.usuario_id}:${item.clave_evento}`
        );

        expect(new Set(combinaciones).size).toBe(
          combinaciones.length
        );

        // Segunda ejecución: la restricción única
        // y findOrCreate deben impedir duplicados.
        const segunda = await generar();

        expect(segunda.totalNotificaciones).toBe(0);
        expect(segunda.notificacionesMandante).toBe(0);
        expect(segunda.notificacionesContratista).toBe(0);

        const cantidadFinal = await Notificacion.count({
          where: {
            clave_evento: {
              [Op.in]: clavesCreadas,
            },
          },
          transaction,
        });

        expect(cantidadFinal).toBe(
          primera.totalNotificaciones
        );

        console.log(
          'Alertas verificadas: mandante, contratista, ' +
          'aislamiento por empresa e idempotencia.'
        );
      } finally {
        // La acreditación, los usuarios ficticios
        // y las notificaciones se revierten juntos.
        await transaction.rollback();

        console.log(
          'ROLLBACK ejecutado sobre todos los datos ficticios.'
        );
      }

      // Confirmar que no quedaron avisos después
      // de revertir la transacción.
      const residuos = await Notificacion.count({
        where: {
          clave_evento: {
            [Op.in]: clavesCreadas,
          },
        },
      });

      expect(residuos).toBe(0);

      console.log(
        'Verificación posterior: cero notificaciones residuales.'
      );
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
