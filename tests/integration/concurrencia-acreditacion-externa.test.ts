import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';
import type { Transaction } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';
const PREFIJO = 'PRISMA-CONCURRENCIA-';

describe('Integración MySQL - concurrencia documental externa', () => {
  it('asigna una revisión a un único administrador concurrente', async () => {
    // Bloquear antes de abrir conexiones o efectuar escrituras.
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
        'BLOQUEADO: esta integración solo admite MySQL local.'
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

    const identificador = randomUUID()
      .replace(/-/g, '')
      .slice(0, 16);

    const rut = 'TEST-' + identificador;
    const nombreContrato = PREFIJO + identificador;
    const nombreDocumento =
      'Documento concurrencia ' + identificador;

    const correo =
      'concurrencia-' + identificador + '@example.invalid';

    const verificarBase = async (
      transaction: Transaction
    ): Promise<void> => {
      const filas = await sequelize.query<{ nombre: string }>(
        'SELECT DATABASE() AS nombre',
        {
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (filas[0]?.nombre !== BASE_PERMITIDA) {
        throw new Error(
          'BLOQUEADO: conexión fuera de la base de integración.'
        );
      }
    };

    // Recuperar IDs mediante identificadores únicos, incluso
    // si la transacción se confirmó antes de devolver resultados.
    const limpiarDatosDeEstaEjecucion =
      async (): Promise<void> => {
        await sequelize.transaction(async transaction => {
          await verificarBase(transaction);

          const contratos = await sequelize.query<{
            id: number;
          }>(
            `SELECT id
             FROM contratos_externos
             WHERE nombre = :nombre`,
            {
              replacements: {
                nombre: nombreContrato,
              },
              type: QueryTypes.SELECT,
              transaction,
            }
          );

          const usuarios = await sequelize.query<{
            id: number;
          }>(
            `SELECT id
             FROM usuarios
             WHERE rut = :rut
               AND correo = :correo`,
            {
              replacements: {
                rut,
                correo,
              },
              type: QueryTypes.SELECT,
              transaction,
            }
          );

          const documentos = await sequelize.query<{
            id: number;
          }>(
            `SELECT id
             FROM documentos
             WHERE nombre = :nombre
               AND empresa_id = 3`,
            {
              replacements: {
                nombre: nombreDocumento,
              },
              type: QueryTypes.SELECT,
              transaction,
            }
          );

          if (
            contratos.length > 1 ||
            usuarios.length > 1 ||
            documentos.length > 1
          ) {
            throw new Error(
              'BLOQUEADO: múltiples registros con el identificador único.'
            );
          }

          const contratoId = contratos[0]?.id;
          const usuarioId = usuarios[0]?.id;
          const documentoId = documentos[0]?.id;

          // Eliminar exclusivamente las acreditaciones y
          // requisitos pertenecientes al contrato ficticio.
          if (contratoId !== undefined) {
            await sequelize.query(
              `DELETE FROM acreditaciones_documentales_externas
               WHERE contrato_id = :id`,
              {
                replacements: {
                  id: contratoId,
                },
                transaction,
              }
            );

            await sequelize.query(
              `DELETE FROM requisitos_documentales_externos
               WHERE contrato_id = :id`,
              {
                replacements: {
                  id: contratoId,
                },
                transaction,
              }
            );

            await sequelize.query(
              `DELETE FROM contratos_externos
               WHERE id = :id
                 AND nombre = :nombre`,
              {
                replacements: {
                  id: contratoId,
                  nombre: nombreContrato,
                },
                transaction,
              }
            );
          }

          // Eliminar exclusivamente el documento ficticio.
          if (documentoId !== undefined) {
            await sequelize.query(
              `DELETE FROM documentos
               WHERE id = :id
                 AND nombre = :nombre
                 AND empresa_id = 3`,
              {
                replacements: {
                  id: documentoId,
                  nombre: nombreDocumento,
                },
                transaction,
              }
            );
          }

          // Eliminar la vinculación y el usuario ficticio.
          if (usuarioId !== undefined) {
            await sequelize.query(
              `DELETE FROM usuarios_empresas_externas
               WHERE usuario_id = :id
                 AND empresa_id = 3`,
              {
                replacements: {
                  id: usuarioId,
                },
                transaction,
              }
            );

            await sequelize.query(
              `DELETE FROM usuarios
               WHERE id = :id
                 AND rut = :rut
                 AND correo = :correo`,
              {
                replacements: {
                  id: usuarioId,
                  rut,
                  correo,
                },
                transaction,
              }
            );
          }

          // Comprobar que no quedan registros principales.
          const filas = await sequelize.query<{
            contratos: number;
            usuarios: number;
            documentos: number;
          }>(
            `SELECT
              (
                SELECT COUNT(*)
                FROM contratos_externos
                WHERE nombre = :contrato
              ) AS contratos,
              (
                SELECT COUNT(*)
                FROM usuarios
                WHERE rut = :rut
                  AND correo = :correo
              ) AS usuarios,
              (
                SELECT COUNT(*)
                FROM documentos
                WHERE nombre = :documento
                  AND empresa_id = 3
              ) AS documentos`,
            {
              replacements: {
                contrato: nombreContrato,
                rut,
                correo,
                documento: nombreDocumento,
              },
              type: QueryTypes.SELECT,
              transaction,
            }
          );

          expect(Number(filas[0].contratos)).toBe(0);
          expect(Number(filas[0].usuarios)).toBe(0);
          expect(Number(filas[0].documentos)).toBe(0);
        });

        console.log(
          'Limpieza verificada para:',
          identificador
        );
      };

    try {
      // Esta transacción se confirma intencionalmente.
      // Las dos conexiones concurrentes deben poder leer
      // la misma acreditación desde MySQL.
      const acreditacionId =
        await sequelize.transaction(async transaction => {
          await verificarBase(transaction);

          const presentador = await Usuario.create(
            {
              rut,
              nombre: 'Usuario',
              apellido: 'Concurrencia',
              correo,
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
              nombre: nombreContrato,
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
                nombre:
                  'Requisito concurrencia ' + identificador,
              },
              type: QueryTypes.INSERT,
              transaction,
            }
          );

          const documento = await Documento.create(
            {
              nombre: nombreDocumento,
              tipo: 'acreditacion_prueba',
              url: '/pruebas/concurrencia-ficticia.pdf',
              version: '1.0',
              empresa_id: 3,
            },
            { transaction }
          );

          const acreditacion =
            await registrarAcreditacionDocumentalExterna({
              administradorId: presentador.id,
              contratoId: contrato.id,
              requisitoId,
              documentoId: documento.id,
              transaction,
            });

          expect(acreditacion.estado).toBe('pendiente');

          return acreditacion.id;
        });

      console.log(
        'Escenario ficticio confirmado:',
        nombreContrato
      );

      // Cada administrador utiliza una transacción distinta.
      // No modificamos la configuración de sesión de MySQL.
      const intentarRevision = (
        administradorId: number
      ) =>
        sequelize.transaction(async transaction => {
          await verificarBase(transaction);

          return revisarAcreditacionDocumentalExterna({
            administradorId,
            acreditacionId,
            accion: 'iniciar_revision',
            transaction,
          });
        });

      const resultados = await Promise.allSettled([
        intentarRevision(2),
        intentarRevision(11),
      ]);

      const exitosos = resultados.filter(
        resultado => resultado.status === 'fulfilled'
      );

      const fallidos = resultados.filter(
        resultado => resultado.status === 'rejected'
      );

      for (const resultado of fallidos) {
        if (resultado.status === 'rejected') {
          console.log(
            'Solicitud rechazada:',
            resultado.reason instanceof Error
              ? resultado.reason.message
              : String(resultado.reason)
          );
        }
      }

      // Un único administrador debe iniciar la revisión.
      expect(exitosos).toHaveLength(1);
      expect(fallidos).toHaveLength(1);

      const ganador =
        resultados[0].status === 'fulfilled' ? 2 : 11;

      const estado =
        await AcreditacionDocumentalExterna.findByPk(
          acreditacionId
        );

      expect(estado?.estado).toBe('en_revision');
      expect(estado?.revisado_por).toBe(ganador);

      console.log(
        'Único administrador asignado:',
        ganador
      );
    } finally {
      // La limpieza se intenta incluso si falla la prueba.
      try {
        await limpiarDatosDeEstaEjecucion();
      } finally {
        await sequelize.close();
      }
    }
  }, 90000);
});
