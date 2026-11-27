// tests/integration/http-desactivacion-faenas-multiempresa.test.ts

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración HTTP - desactivación segura de faenas', () => {
  it('impide desactivar una faena perteneciente a otra empresa', async () => {
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

    const { sequelize, Usuario, Faena } =
      await import('../../src/models');

    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);
    const rut = `TEST-DELETE-RESP-${sufijo}`;
    const correo = `test-delete-resp-${sufijo}@example.invalid`;
    const nombre = `TEST-FAENA-DELETE-${sufijo}`;


    let responsableId: number | undefined;
    let faenaId: number | undefined;

    const verificarBase = async (): Promise<void> => {
      const filas = await sequelize.query<{ nombre: string }>(
        'SELECT DATABASE() AS nombre',
        { type: QueryTypes.SELECT }
      );

      if (filas[0]?.nombre !== BASE_PERMITIDA) {
        throw new Error('BLOQUEADO: conexión MySQL incorrecta.');
      }
    };

    try {
      await verificarBase();

      const referencias = await sequelize.query<{
        administrador_id: number;
      }>(
        `SELECT u.id AS administrador_id
         FROM usuarios u
         INNER JOIN faenas f ON f.id = u.faena_id
         INNER JOIN empresas e ON e.id = 3
         WHERE u.id = 2
           AND u.rol_id = 1
           AND u.activo = 1
           AND f.empresa_id = 1`,
        { type: QueryTypes.SELECT }
      );

      expect(referencias).toHaveLength(1);

      const secreto = process.env.JWT_SECRET;

      if (!secreto || secreto.length < 32) {
        throw new Error('JWT_SECRET de pruebas inválido.');
      }

      // Crear exclusivamente registros temporales identificables.
      await sequelize.transaction(async transaction => {
        const responsable = await Usuario.create(
          {
            rut,
            nombre: 'Responsable',
            apellido: 'Temporal',
            correo,
            rol_id: 3,
            contraseña_hash: 'NO_UTILIZABLE_SOLO_PRUEBAS',
            salt: 'SALT_SOLO_PRUEBAS',
            activo: true,
          },
          { transaction }
        );

        responsableId = Number(responsable.get('id'));

        const faena = await Faena.create(
          {
            nombre,
            descripcion: 'Integración de aislamiento DELETE',
            empresa_id: 3,
            ubicacion: 'Entorno exclusivo de pruebas',
            responsable_id: responsableId,
            activo: true,
          },
          { transaction }
        );

        faenaId = Number(faena.get('id'));
      });

      const { default: app } = await import('../../src/app');

      const token = jwt.sign(
        { id: 2, rol_id: 1 },
        secreto,
        { expiresIn: '5m' }
      );

      const respuesta = await request(app)
        .delete(`/api/faenas/${faenaId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(respuesta.status).toBe(404);

      // La faena debe conservar exactamente sus datos originales.
      const faena = await Faena.findByPk(faenaId);

      expect(faena).not.toBeNull();
      expect(faena?.get('nombre')).toBe(nombre);
      expect(Number(faena?.get('empresa_id'))).toBe(3);
      expect(faena?.get('activo')).toBe(true);

      console.log('✅ Desactivación cruzada rechazada con HTTP 404.');
      console.log('✅ Faena de empresa 3 conservada sin cambios.');
    } finally {
      try {
        await verificarBase();

        await sequelize.transaction(async transaction => {
          const usuarios = await sequelize.query<{ id: number }>(
            `SELECT id FROM usuarios
             WHERE rut = :rut AND correo = :correo`,
            {
              replacements: { rut, correo },
              type: QueryTypes.SELECT,
              transaction,
            }
          );

          const faenas = await sequelize.query<{
            id: number;
            responsable_id: number;
          }>(
            `SELECT id, responsable_id
             FROM faenas
             WHERE nombre = :nombre
               AND empresa_id = 3`,
            {
              replacements: { nombre },
              type: QueryTypes.SELECT,
              transaction,
            }
          );

          if (usuarios.length > 1 || faenas.length > 1) {
            throw new Error('BLOQUEADO: registros temporales duplicados.');
          }

          if (
            usuarios.length &&
            responsableId !== undefined &&
            Number(usuarios[0].id) !== responsableId
          ) {
            throw new Error('BLOQUEADO: responsable inesperado.');
          }

          if (
            faenas.length &&
            (
              Number(faenas[0].responsable_id) !==
                Number(usuarios[0]?.id) ||
              (faenaId !== undefined &&
                Number(faenas[0].id) !== faenaId)
            )
          ) {
            throw new Error('BLOQUEADO: faena inesperada.');
          }

          if (faenas.length) {
            await Faena.destroy({
              where: {
                id: faenas[0].id,
                empresa_id: 3,
                responsable_id: faenas[0].responsable_id,
              },
              transaction,
            });
          }

          if (usuarios.length) {
            await Usuario.destroy({
              where: {
                id: usuarios[0].id,
                rut,
                correo,
              },
              transaction,
            });
          }
        });

        const restantes = await sequelize.query<{
          usuarios: number;
          faenas: number;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM usuarios
              WHERE rut = :rut AND correo = :correo) AS usuarios,
             (SELECT COUNT(*) FROM faenas
              WHERE nombre = :nombre) AS faenas`,
          {
            replacements: { rut, correo, nombre },
            type: QueryTypes.SELECT,
          }
        );

        expect(Number(restantes[0].usuarios)).toBe(0);
        expect(Number(restantes[0].faenas)).toBe(0);

        console.log('✅ Limpieza confirmada: cero registros temporales.');
      } finally {
        await sequelize.close();
      }
    }
  }, 60000);
});
