// tests/integration/http-faenas-multiempresa.test.ts

import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración HTTP - faenas multiempresa', () => {
  it('lista únicamente faenas activas de la empresa autorizada', async () => {
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

    const { sequelize } = await import('../../src/models');

    try {
      const bases = await sequelize.query<{ nombre: string }>(
        'SELECT DATABASE() AS nombre',
        { type: QueryTypes.SELECT }
      );

      if (bases[0]?.nombre !== BASE_PERMITIDA) {
        throw new Error('BLOQUEADO: conexión MySQL incorrecta.');
      }

      // Confirmar que el administrador sigue asociado a empresa 1.
      const administradores = await sequelize.query<{
        id: number;
        empresa_id: number;
      }>(
        `SELECT u.id, f.empresa_id
         FROM usuarios u
         INNER JOIN faenas f ON f.id = u.faena_id
         WHERE u.id = 2
           AND u.rol_id = 1
           AND u.activo = 1`,
        { type: QueryTypes.SELECT }
      );

      expect(administradores).toHaveLength(1);
      expect(Number(administradores[0].empresa_id)).toBe(1);

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
        .get('/api/faenas')
        .set('Authorization', `Bearer ${token}`);

      expect(respuesta.status).toBe(200);
      expect(Array.isArray(respuesta.body)).toBe(true);

      const faenas = respuesta.body as Array<{
        id: number;
        empresa_id: number;
        activo: boolean;
      }>;

      expect(faenas.length).toBeGreaterThan(0);

      for (const faena of faenas) {
        expect(Number(faena.empresa_id)).toBe(1);
        expect(faena.activo).toBe(true);
      }

      console.log(
        '✅ Listado HTTP restringido a faenas activas de empresa 1.'
      );

      const sinToken = await request(app).get('/api/faenas');

      expect(sinToken.status).toBe(401);

      console.log('✅ Consulta sin JWT rechazada.');
      console.log('✅ Integración exclusivamente de lectura.');
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
