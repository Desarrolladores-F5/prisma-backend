import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - acreditación documental externa', () => {
  it('presenta, aprueba y rechaza acreditaciones con rollback', async () => {
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
        'BLOQUEADO: las pruebas solamente permiten MySQL local.'
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

    try {
      const transaction = await sequelize.transaction();

      try {
        // Comprobar la base real de la misma conexión transaccional.
        // No realizar ninguna escritura antes de esta validación.
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

        console.log(
          'Base de datos transaccional verificada:',
          bases[0].nombre
        );

        const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

        // Usuario ficticio, sin credenciales reales.
        const presentador = await Usuario.create(
          {
            rut: 'TEST-' + sufijo,
            nombre: 'Usuario',
            apellido: 'Integracion',
            correo: 'integracion-' + sufijo + '@example.invalid',
            rol_id: 3,
            contraseña_hash: 'CREDENCIAL_NO_UTILIZABLE_SOLO_TEST',
            salt: 'SALT_SOLO_TEST',
            activo: true,
          },
          { transaction }
        );

        // Vinculación temporal con la contratista.
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
            nombre: 'Contrato ficticio integración PRISMA',
            estado: 'pendiente',
          },
          { transaction }
        );

        // Requisito documental empresarial.
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
              nombre: 'Requisito ficticio de integración',
            },
            type: QueryTypes.INSERT,
            transaction,
          }
        );

        const documento = await Documento.create(
          {
            nombre: 'Documento ficticio integración PRISMA',
            tipo: 'acreditacion_prueba',
            url: '/pruebas/documento-ficticio.pdf',
            version: '1.0',
            empresa_id: 3,
          },
          { transaction }
        );

        const presentar = () =>
          registrarAcreditacionDocumentalExterna({
            administradorId: presentador.id,
            contratoId: contrato.id,
            requisitoId,
            documentoId: documento.id,
            transaction,
          });

        // ESCENARIO 1: presentación y aprobación.
        const aprobacion = await presentar();

        expect(aprobacion.estado).toBe('pendiente');
        expect(aprobacion.presentado_por).toBe(presentador.id);

        const inicioAprobacion =
          await revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId: aprobacion.id,
            accion: 'iniciar_revision',
            transaction,
          });

        expect(inicioAprobacion.estado).toBe('en_revision');

        // Un administrador distinto no puede finalizar la revisión.
        await expect(
          revisarAcreditacionDocumentalExterna({
            administradorId: 11,
            acreditacionId: aprobacion.id,
            accion: 'aprobar',
            transaction,
          })
        ).rejects.toMatchObject({ estadoHttp: 403 });

        const aprobada =
          await revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId: aprobacion.id,
            accion: 'aprobar',
            transaction,
          });

        expect(aprobada.estado).toBe('aprobado');

        // ESCENARIO 2: presentación y rechazo.
        const rechazo = await presentar();

        expect(rechazo.estado).toBe('pendiente');

        await revisarAcreditacionDocumentalExterna({
          administradorId: 2,
          acreditacionId: rechazo.id,
          accion: 'iniciar_revision',
          transaction,
        });

        // Rechazar sin observaciones debe fallar.
        await expect(
          revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId: rechazo.id,
            accion: 'rechazar',
            transaction,
          })
        ).rejects.toMatchObject({ estadoHttp: 400 });

        const rechazada =
          await revisarAcreditacionDocumentalExterna({
            administradorId: 2,
            acreditacionId: rechazo.id,
            accion: 'rechazar',
            observaciones:
              'Documento ficticio rechazado en integración.',
            transaction,
          });

        expect(rechazada.estado).toBe('rechazado');

        // Verificar los resultados reales dentro de la transacción.
        const estadoAprobado =
          await AcreditacionDocumentalExterna.findByPk(
            aprobacion.id,
            { transaction }
          );

        const estadoRechazado =
          await AcreditacionDocumentalExterna.findByPk(
            rechazo.id,
            { transaction }
          );

        expect(estadoAprobado?.estado).toBe('aprobado');
        expect(estadoRechazado?.estado).toBe('rechazado');

        expect(estadoAprobado?.revisado_por).toBe(2);
        expect(estadoRechazado?.revisado_por).toBe(2);

        expect(estadoAprobado?.fecha_revision).not.toBeNull();
        expect(estadoRechazado?.fecha_revision).not.toBeNull();

        expect(estadoRechazado?.observaciones).toBe(
          'Documento ficticio rechazado en integración.'
        );

        console.log(
          'Integración verificada: presentación, aprobación, rechazo y permisos.'
        );
      } finally {
        // Nunca confirmar los datos ficticios.
        await transaction.rollback();
        console.log(
          'ROLLBACK ejecutado: datos ficticios revertidos.'
        );
      }
    } finally {
      await sequelize.close();
    }
  }, 30000);
});
