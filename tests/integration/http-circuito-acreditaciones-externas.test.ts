// tests/integration/http-circuito-acreditaciones-externas.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { QueryTypes } from 'sequelize';
import type { Transaction } from 'sequelize';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

/**
 * Contexto exclusivo de esta prueba.
 * Nunca se obtiene una transacción desde una petición HTTP.
 */
const contexto = vi.hoisted(() => ({
  transaction: null as Transaction | null,
}));

/**
 * Mantener el servicio REAL de presentación.
 * Solo incorporar la transacción controlada por Vitest.
 */
vi.mock(
  '../../src/services/registroAcreditacionDocumentalExterna.service',
  async importOriginal => {
    const original = await importOriginal<
      typeof import(
        '../../src/services/registroAcreditacionDocumentalExterna.service'
      )
    >();

    return {
      ...original,
      registrarAcreditacionDocumentalExterna: (
        parametros: Parameters<
          typeof original.registrarAcreditacionDocumentalExterna
        >[0]
      ) => {
        if (!contexto.transaction) {
          throw new Error('Transacción de prueba no disponible.');
        }

        return original.registrarAcreditacionDocumentalExterna({
          ...parametros,
          transaction: contexto.transaction,
        });
      },
    };
  }
);

/**
 * Mantener el servicio REAL de revisión.
 */
vi.mock(
  '../../src/services/revisionAcreditacionDocumentalExterna.service',
  async importOriginal => {
    const original = await importOriginal<
      typeof import(
        '../../src/services/revisionAcreditacionDocumentalExterna.service'
      )
    >();

    return {
      ...original,
      revisarAcreditacionDocumentalExterna: (
        parametros: Parameters<
          typeof original.revisarAcreditacionDocumentalExterna
        >[0]
      ) => {
        if (!contexto.transaction) {
          throw new Error('Transacción de prueba no disponible.');
        }

        return original.revisarAcreditacionDocumentalExterna({
          ...parametros,
          transaction: contexto.transaction,
        });
      },
    };
  }
);

/**
 * Mantener el servicio REAL de consulta.
 */
vi.mock(
  '../../src/services/consultaAcreditacionesExternas.service',
  async importOriginal => {
    const original = await importOriginal<
      typeof import(
        '../../src/services/consultaAcreditacionesExternas.service'
      )
    >();

    return {
      ...original,
      obtenerAcreditacionesExternasContrato: (
        parametros: Parameters<
          typeof original.obtenerAcreditacionesExternasContrato
        >[0]
      ) => {
        if (!contexto.transaction) {
          throw new Error('Transacción de prueba no disponible.');
        }

        return original.obtenerAcreditacionesExternasContrato({
          ...parametros,
          transaction: contexto.transaction,
        });
      },
    };
  }
);

describe('Integración HTTP y MySQL - circuito documental externo', () => {
  it('presenta, revisa, consulta, aísla y revierte los datos', async () => {
    // Bloqueos previos a cualquier operación SQL.
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

    if (contexto.transaction) {
      throw new Error('Existe una transacción de prueba pendiente.');
    }

    const {
      sequelize,
      Usuario,
      UsuarioEmpresaExterna,
      ContratoExterno,
      Documento,
      AcreditacionDocumentalExterna,
    } = await import('../../src/models');

    // Importar el router solo después de validar el entorno.
    const { default: router } = await import(
      '../../src/routes/contratosExternos.routes'
    );

    const app = express();
    app.use(express.json());
    app.use('/api/contratos-externos', router);

    const secreto = process.env.JWT_SECRET;

    if (!secreto || secreto.length < 32) {
      throw new Error('JWT_SECRET de pruebas inválido.');
    }

    const generarToken = (id: number, rol_id: number) =>
      `Bearer ${jwt.sign(
        { id, rol_id },
        secreto,
        { expiresIn: '5m' }
      )}`;

    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

    let contratoId: number | null = null;
    let presentadorId: number | null = null;
    let terceroId: number | null = null;
    let documentoId: number | null = null;
    let requisitoId: number | null = null;

    const acreditacionIds: number[] = [];

    try {
      const transaction = await sequelize.transaction();
      contexto.transaction = transaction;

      try {
        // Verificar la base de la conexión transaccional real.
        const bases = await sequelize.query<{ nombre: string }>(
          'SELECT DATABASE() AS nombre',
          {
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        if (bases[0]?.nombre !== BASE_PERMITIDA) {
          throw new Error(
            'BLOQUEADO: conexión MySQL fuera de la base aislada.'
          );
        }

        console.log('✅ Base MySQL transaccional verificada.');

        const presentador = await Usuario.create(
          {
            rut: `TEST-HTTP-P-${sufijo}`,
            nombre: 'Presentador',
            apellido: 'Prueba',
            correo: `http-p-${sufijo}@example.invalid`,
            rol_id: 3,
            contraseña_hash:
              'CREDENCIAL_NO_UTILIZABLE_SOLO_TEST',
            salt: 'SALT_SOLO_TEST',
            activo: true,
          },
          { transaction }
        );

        presentadorId = presentador.id;

        const tercero = await Usuario.create(
          {
            rut: `TEST-HTTP-T-${sufijo}`,
            nombre: 'Tercero',
            apellido: 'Prueba',
            correo: `http-t-${sufijo}@example.invalid`,
            rol_id: 3,
            contraseña_hash:
              'CREDENCIAL_NO_UTILIZABLE_SOLO_TEST',
            salt: 'SALT_SOLO_TEST',
            activo: true,
          },
          { transaction }
        );

        terceroId = tercero.id;

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
            nombre: `Contrato circuito HTTP ${sufijo}`,
            estado: 'pendiente',
          },
          { transaction }
        );

        contratoId = contrato.id;

        const [nuevoRequisitoId] = await sequelize.query(
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
              nombre: `Requisito HTTP ${sufijo}`,
            },
            type: QueryTypes.INSERT,
            transaction,
          }
        );

        requisitoId = nuevoRequisitoId;

        const documento = await Documento.create(
          {
            nombre: `Documento HTTP ${sufijo}`,
            tipo: 'acreditacion_prueba',
            url: '/pruebas/documento-http-ficticio.pdf',
            version: '1.0',
            empresa_id: 3,
          },
          { transaction }
        );

        documentoId = documento.id;

        const rutaPresentacion =
          `/api/contratos-externos/${contrato.id}/acreditaciones`;

        const tokenContratista = generarToken(
          presentador.id,
          3
        );

        const tokenMandante = generarToken(2, 1);
        const tokenTercero = generarToken(tercero.id, 3);

        const presentar = async () => {
          const respuesta = await request(app)
            .post(rutaPresentacion)
            .set('Authorization', tokenContratista)
            .send({
              requisitoId,
              documentoId,
            });

          expect(respuesta.status).toBe(201);
          expect(respuesta.body.acreditacion.estado).toBe(
            'pendiente'
          );

          const id = respuesta.body.acreditacion.id;

          expect(Number.isSafeInteger(id)).toBe(true);
          acreditacionIds.push(id);

          return id as number;
        };

        const aprobacionId = await presentar();
        const rechazoId = await presentar();

        console.log('✅ Presentaciones HTTP verificadas.');

        const rutaRevision = (id: number) =>
          `/api/contratos-externos/acreditaciones/${id}/revision`;

        const iniciar = async (id: number) => {
          const respuesta = await request(app)
            .patch(rutaRevision(id))
            .set('Authorization', tokenMandante)
            .send({ accion: 'iniciar_revision' });

          expect(respuesta.status).toBe(200);
          expect(respuesta.body.revision.estado).toBe(
            'en_revision'
          );
        };

        await iniciar(aprobacionId);
        await iniciar(rechazoId);

        const aprobada = await request(app)
          .patch(rutaRevision(aprobacionId))
          .set('Authorization', tokenMandante)
          .send({
            accion: 'aprobar',
            observaciones: 'Documento conforme.',
          });

        expect(aprobada.status).toBe(200);
        expect(aprobada.body.revision.estado).toBe(
          'aprobado'
        );

        const rechazada = await request(app)
          .patch(rutaRevision(rechazoId))
          .set('Authorization', tokenMandante)
          .send({
            accion: 'rechazar',
            observaciones: 'Documento no conforme.',
          });

        expect(rechazada.status).toBe(200);
        expect(rechazada.body.revision.estado).toBe(
          'rechazado'
        );

        console.log('✅ Aprobación y rechazo HTTP verificados.');

        const consultaMandante = await request(app)
          .get(`${rutaPresentacion}?pagina=1&limite=20`)
          .set('Authorization', tokenMandante);

        expect(consultaMandante.status).toBe(200);
        expect(consultaMandante.body.tipoAcceso).toBe(
          'mandante'
        );
        expect(consultaMandante.body.total).toBe(2);

        const estados = consultaMandante.body.acreditaciones.map(
          (item: { estado: string }) => item.estado
        );

        expect(estados).toContain('aprobado');
        expect(estados).toContain('rechazado');

        const consultaContratista = await request(app)
          .get(rutaPresentacion)
          .set('Authorization', tokenContratista);

        expect(consultaContratista.status).toBe(200);
        expect(consultaContratista.body.tipoAcceso).toBe(
          'contratista'
        );
        expect(consultaContratista.body.total).toBe(2);

        const consultaTercero = await request(app)
          .get(rutaPresentacion)
          .set('Authorization', tokenTercero);

        expect(consultaTercero.status).toBe(403);

        console.log(
          '✅ Consultas HTTP y aislamiento multiempresa verificados.'
        );
      } finally {
        // Retirar la adaptación antes de cerrar la transacción.
        contexto.transaction = null;

        if (!transaction.finished) {
          await transaction.rollback();
          console.log('✅ ROLLBACK ejecutado.');
        }
      }

      // Verificar la ausencia de los registros principales.
      for (const id of acreditacionIds) {
        expect(
          await AcreditacionDocumentalExterna.findByPk(id)
        ).toBeNull();
      }

      if (contratoId !== null) {
        expect(
          await ContratoExterno.findByPk(contratoId)
        ).toBeNull();
      }

      if (documentoId !== null) {
        expect(
          await Documento.findByPk(documentoId)
        ).toBeNull();
      }

      for (const id of [presentadorId, terceroId]) {
        if (id !== null) {
          expect(await Usuario.findByPk(id)).toBeNull();
        }
      }

      if (requisitoId !== null) {
        const requisitos = await sequelize.query<{ total: number }>(
          `SELECT COUNT(*) AS total
             FROM requisitos_documentales_externos
            WHERE id = :requisitoId`,
          {
            replacements: { requisitoId },
            type: QueryTypes.SELECT,
          }
        );

        expect(Number(requisitos[0]?.total)).toBe(0);
      }

      console.log(
        '✅ Sin registros ficticios residuales verificados.'
      );
    } finally {
      contexto.transaction = null;
      await sequelize.close();
    }
  }, 120000);
});
