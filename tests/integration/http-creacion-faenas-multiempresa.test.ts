// tests/integration/http-creacion-faenas-multiempresa.test.ts

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración HTTP - creación segura de faenas', () => {
  it('crea una faena propia aunque el cliente envíe empresa ajena', async () => {
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

    const { sequelize, Faena } = await import('../../src/models');

    const nombre = `TEST-FAENA-POST-${randomUUID()}`;
    let faenaId: number | undefined;

    const verificarBase = async (): Promise<void> => {
      const bases = await sequelize.query<{ nombre: string }>(
        'SELECT DATABASE() AS nombre',
        { type: QueryTypes.SELECT }
      );

      if (bases[0]?.nombre !== BASE_PERMITIDA) {
        throw new Error('BLOQUEADO: conexión MySQL incorrecta.');
      }
    };

    try {
      await verificarBase();

      // Comprobar las relaciones vigentes antes de escribir.
      const referencias = await sequelize.query<{
        administrador_id: number;
        responsable_id: number;
      }>(
        `SELECT
           a.id AS administrador_id,
           r.id AS responsable_id
         FROM usuarios a
         INNER JOIN faenas fa ON fa.id = a.faena_id
         INNER JOIN usuarios r ON r.id = 25
         INNER JOIN faenas fr ON fr.id = r.faena_id
         WHERE a.id = 2
           AND a.rol_id = 1
           AND a.activo = 1
           AND fa.empresa_id = 1
           AND r.activo = 1
           AND fr.empresa_id = 1`,
        { type: QueryTypes.SELECT }
      );

      expect(referencias).toHaveLength(1);

      const secreto = process.env.JWT_SECRET;

      if (!secreto || secreto.length < 32) {
        throw new Error('JWT_SECRET de pruebas inválido.');
      }

      const { default: app } = await import('../../src/app');

      const token = jwt.sign(
        { id: 2, rol_id: 1 },
        secreto,
        { expiresIn: '5m' }
      );

      const respuesta = await request(app)
        .post('/api/faenas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre,
          ubicacion: 'Prueba controlada de integración',
          responsable_id: 25,
          empresa_id: 3,
          activo: false,
        });

      expect(respuesta.status).toBe(201);

      faenaId = Number(respuesta.body.id);

      expect(Number.isSafeInteger(faenaId)).toBe(true);
      expect(faenaId).toBeGreaterThan(0);

      const faena = await Faena.findByPk(faenaId);

      expect(faena).not.toBeNull();
      expect(faena?.get('nombre')).toBe(nombre);
      expect(Number(faena?.get('empresa_id'))).toBe(1);
      expect(Number(faena?.get('responsable_id'))).toBe(25);
      expect(faena?.get('activo')).toBe(true);

      console.log('✅ Faena temporal creada en empresa 1.');
      console.log('✅ empresa_id=3 enviado por cliente fue ignorado.');
      console.log('✅ activo=false enviado por cliente fue ignorado.');
    } finally {
      try {
        await verificarBase();

        // Solo puede existir un registro con el nombre temporal único.
        const registros = await sequelize.query<{
          id: number;
          empresa_id: number;
          responsable_id: number;
        }>(
          `SELECT id, empresa_id, responsable_id
           FROM faenas
           WHERE nombre = :nombre`,
          {
            replacements: { nombre },
            type: QueryTypes.SELECT,
          }
        );

        if (registros.length > 1) {
          throw new Error('BLOQUEADO: registros temporales duplicados.');
        }

        if (registros.length === 1) {
          const registro = registros[0];

          if (
            Number(registro.empresa_id) !== 1 ||
            Number(registro.responsable_id) !== 25 ||
            (faenaId !== undefined &&
              Number(registro.id) !== faenaId)
          ) {
            throw new Error(
              'BLOQUEADO: el registro no coincide con la prueba.'
            );
          }

          await Faena.destroy({
            where: {
              id: registro.id,
              nombre,
              empresa_id: 1,
              responsable_id: 25,
            },
          });
        }

        const restantes = await sequelize.query<{
          total: number;
        }>(
          `SELECT COUNT(*) AS total
           FROM faenas
           WHERE nombre = :nombre`,
          {
            replacements: { nombre },
            type: QueryTypes.SELECT,
          }
        );

        expect(Number(restantes[0].total)).toBe(0);

        console.log('✅ Limpieza confirmada: cero faenas temporales.');
      } finally {
        await sequelize.close();
      }
    }
  }, 60000);
});
