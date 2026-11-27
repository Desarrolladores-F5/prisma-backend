// tests/integration/http-aislamiento-cruzado-usuarios.test.ts

import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración HTTP - aislamiento cruzado de usuarios', () => {
  it('impide consultar por HTTP un usuario confirmado de otra empresa', async () => {
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

    const verificarBase = async (): Promise<void> => {
      const bases = await sequelize.query<{ nombre: string }>(
        'SELECT DATABASE() AS nombre',
        { type: QueryTypes.SELECT }
      );

      if (bases[0]?.nombre !== BASE_PERMITIDA) {
        throw new Error('BLOQUEADO: conexión MySQL incorrecta.');
      }
    };

    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

    const rutResponsable = `TEST-HTTP-RESP-${sufijo}`;
    const correoResponsable =
      `http-resp-${sufijo}@example.invalid`;

    const rutTrabajador = `TEST-HTTP-TRAB-${sufijo}`;
    const correoTrabajador =
      `http-trab-${sufijo}@example.invalid`;

    const nombreFaena = `TEST-HTTP-FAENA-${sufijo}`;

    let responsableId: number | undefined;
    let faenaId: number | undefined;
    let trabajadorId: number | undefined;

    const limpiar = async (): Promise<void> => {
      await verificarBase();

      await sequelize.transaction(async transaction => {
        const obtenerIds = async (
          rut: string,
          correo: string
        ): Promise<number[]> => {
          const filas = await sequelize.query<{ id: number }>(
            `SELECT id FROM usuarios
             WHERE rut = :rut AND correo = :correo`,
            {
              replacements: { rut, correo },
              type: QueryTypes.SELECT,
              transaction,
            }
          );

          if (filas.length > 1) {
            throw new Error('BLOQUEADO: usuarios temporales duplicados.');
          }

          return filas.map(fila => Number(fila.id));
        };

        const responsables = await obtenerIds(
          rutResponsable,
          correoResponsable
        );

        const trabajadores = await obtenerIds(
          rutTrabajador,
          correoTrabajador
        );

        const faenas = await sequelize.query<{
          id: number;
          responsable_id: number;
        }>(
          `SELECT id, responsable_id
           FROM faenas
           WHERE nombre = :nombre AND empresa_id = 3`,
          {
            replacements: { nombre: nombreFaena },
            type: QueryTypes.SELECT,
            transaction,
          }
        );

        if (faenas.length > 1) {
          throw new Error('BLOQUEADO: faenas temporales duplicadas.');
        }

        if (
          trabajadorId !== undefined &&
          trabajadores.some(id => id !== trabajadorId)
        ) {
          throw new Error('BLOQUEADO: trabajador inesperado.');
        }

        if (
          responsableId !== undefined &&
          responsables.some(id => id !== responsableId)
        ) {
          throw new Error('BLOQUEADO: responsable inesperado.');
        }

        if (
          faenaId !== undefined &&
          faenas.some(faena => Number(faena.id) !== faenaId)
        ) {
          throw new Error('BLOQUEADO: faena inesperada.');
        }

        if (
          faenas.length &&
          !responsables.includes(Number(faenas[0].responsable_id))
        ) {
          throw new Error('BLOQUEADO: responsable de faena inesperado.');
        }

        // Primero el trabajador; después su faena y responsable.
        if (trabajadores.length) {
          await Usuario.destroy({
            where: {
              id: trabajadores[0],
              rut: rutTrabajador,
              correo: correoTrabajador,
            },
            transaction,
          });
        }

        if (faenas.length) {
          await Faena.destroy({
            where: {
              id: faenas[0].id,
              nombre: nombreFaena,
              empresa_id: 3,
              responsable_id: faenas[0].responsable_id,
            },
            transaction,
          });
        }

        if (responsables.length) {
          await Usuario.destroy({
            where: {
              id: responsables[0],
              rut: rutResponsable,
              correo: correoResponsable,
            },
            transaction,
          });
        }
      });

      // Comprobación independiente después de confirmar la limpieza.
      const residuales = await sequelize.query<{
        usuarios: number;
        faenas: number;
      }>(
        `SELECT
          (
            SELECT COUNT(*) FROM usuarios
            WHERE (rut = :rutResponsable AND correo = :correoResponsable)
               OR (rut = :rutTrabajador AND correo = :correoTrabajador)
          ) AS usuarios,
          (
            SELECT COUNT(*) FROM faenas
            WHERE nombre = :nombreFaena AND empresa_id = 3
          ) AS faenas`,
        {
          replacements: {
            rutResponsable,
            correoResponsable,
            rutTrabajador,
            correoTrabajador,
            nombreFaena,
          },
          type: QueryTypes.SELECT,
        }
      );

      expect(Number(residuales[0].usuarios)).toBe(0);
      expect(Number(residuales[0].faenas)).toBe(0);

      console.log('✅ Limpieza confirmada: cero registros temporales.');
    };

    try {
      await verificarBase();

      // La transacción se confirma para permitir consultas HTTP
      // desde conexiones independientes.
      await sequelize.transaction(async transaction => {
        const responsable = await Usuario.create(
          {
            rut: rutResponsable,
            nombre: 'Responsable',
            apellido: 'Temporal',
            correo: correoResponsable,
            rol_id: 3,
            contraseña_hash: 'NO_UTILIZABLE_SOLO_PRUEBAS',
            salt: 'SALT_SOLO_PRUEBAS',
            activo: true,
          },
          { transaction }
        );

        responsableId = responsable.id;

        const faena = await Faena.create(
          {
            nombre: nombreFaena,
            descripcion: 'Prueba HTTP de aislamiento',
            empresa_id: 3,
            ubicacion: 'Entorno de pruebas',
            responsable_id: responsable.id,
            activo: true,
          },
          { transaction }
        );

        faenaId = Number(faena.get('id'));

        const trabajador = await Usuario.create(
          {
            rut: rutTrabajador,
            nombre: 'Trabajador',
            apellido: 'Temporal',
            correo: correoTrabajador,
            rol_id: 3,
            faena_id: faenaId,
            contraseña_hash: 'NO_UTILIZABLE_SOLO_PRUEBAS',
            salt: 'SALT_SOLO_PRUEBAS',
            activo: true,
          },
          { transaction }
        );

        trabajadorId = trabajador.id;
      });

      // Prueba positiva: el usuario existe realmente y es visible.
      const trabajadorVisible = await Usuario.findByPk(
        trabajadorId!,
        {
          include: [{
            model: Faena,
            as: 'faena',
            required: true,
            where: { empresa_id: 3 },
          }],
        }
      );

      expect(trabajadorVisible).not.toBeNull();
      expect(trabajadorVisible?.id).toBe(trabajadorId);

      console.log('✅ Trabajador de empresa 3 visible en MySQL.');

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

      const autorizacion = {
        Authorization: `Bearer ${token}`,
      };

      const consultaAjena = await request(app)
        .get(`/api/usuarios/${trabajadorId}`)
        .set(autorizacion);

      expect(consultaAjena.status).toBe(404);

      const listadoFaenaAjena = await request(app)
        .get(`/api/usuarios/faena/${faenaId}`)
        .set(autorizacion);

      expect(listadoFaenaAjena.status).toBe(200);
      expect(listadoFaenaAjena.body).toEqual([]);

      const listado = await request(app)
        .get('/api/usuarios')
        .set(autorizacion);

      expect(listado.status).toBe(200);
      expect(
        listado.body.some(
          (usuario: { id: number }) => usuario.id === trabajadorId
        )
      ).toBe(false);

      const conteo = await request(app)
        .get('/api/usuarios/conteo/total')
        .set(autorizacion);

      expect(conteo.status).toBe(200);
      expect(conteo.body).toEqual({ total: 13 });

      console.log('✅ Consulta HTTP ajena rechazada con 404.');
      console.log('✅ Listado por faena ajena vacío.');
      console.log('✅ Usuario ajeno excluido del listado general.');
      console.log('✅ Conteo de empresa 1 no incluye al trabajador ajeno.');
    } finally {
      try {
        await limpiar();
      } finally {
        await sequelize.close();
      }
    }
  }, 60000);
});
