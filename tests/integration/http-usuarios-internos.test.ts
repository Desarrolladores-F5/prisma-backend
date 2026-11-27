// tests/integration/http-usuarios-internos.test.ts

import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración HTTP - usuarios internos multiempresa', () => {
  it('valida listado, conteo y autenticación con MySQL real', async () => {
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

    const bases = await sequelize.query<{ nombre: string }>(
      'SELECT DATABASE() AS nombre',
      { type: QueryTypes.SELECT }
    );

    if (bases[0]?.nombre !== BASE_PERMITIDA) {
      throw new Error('BLOQUEADO: conexión MySQL incorrecta.');
    }

    const secreto = process.env.JWT_SECRET;

    if (!secreto || secreto.length < 32) {
      throw new Error('JWT_SECRET de pruebas inválido.');
    }

    const { default: app } = await import('../../src/app');

    const token = (id: number, rol_id: number) =>
      jwt.sign({ id, rol_id }, secreto, {
        expiresIn: '5m',
      });

    for (const identidad of [
      { id: 2, rol_id: 1 },
      { id: 9, rol_id: 2 },
    ]) {
      const autorizacion = {
        Authorization: `Bearer ${token(
          identidad.id,
          identidad.rol_id
        )}`,
      };

      const listado = await request(app)
        .get('/api/usuarios')
        .set(autorizacion);

      expect(listado.status).toBe(200);
      expect(Array.isArray(listado.body)).toBe(true);
      expect(listado.body).toHaveLength(13);

      for (const usuario of listado.body) {
        expect(usuario).not.toHaveProperty('contraseña_hash');
        expect(usuario).not.toHaveProperty('salt');
      }

      const conteo = await request(app)
        .get('/api/usuarios/conteo/total')
        .set(autorizacion);

      expect(conteo.status).toBe(200);
      expect(conteo.body).toEqual({ total: 13 });
    }

    const sinToken = await request(app)
      .get('/api/usuarios/conteo/total');

    expect(sinToken.status).toBe(401);

    console.log('✅ Administrador: listado y conteo autorizados.');
    console.log('✅ Supervisor: listado y conteo autorizados.');
    console.log('✅ Credenciales excluidas de las respuestas.');
    console.log('✅ Consulta sin JWT rechazada.');
    console.log('✅ Prueba exclusivamente de lectura.');
  });
});
