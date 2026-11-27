// tests/integration/aislamiento-usuarios-internos.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Op, QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - aislamiento de usuarios internos', () => {
  it('aísla consultas y conteos entre empresas con ROLLBACK', async () => {
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

    const { sequelize, Usuario, Faena } = await import('../../src/models');

    const bases = await sequelize.query<{ nombre: string }>(
      'SELECT DATABASE() AS nombre',
      { type: QueryTypes.SELECT }
    );

    if (bases[0]?.nombre !== BASE_PERMITIDA) {
      throw new Error('BLOQUEADO: conexión MySQL incorrecta.');
    }

    const transaction = await sequelize.transaction();

    try {
      const faenaEmpresa1 = await Faena.findOne({
        where: { empresa_id: 1 },
        transaction,
      });

      if (!faenaEmpresa1) {
        throw new Error('No existe una faena de referencia para empresa 1.');
      }

      const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

      const crearTrabajador = (tipo: string, faenaId?: number) =>
        Usuario.create(
          {
            rut: `TEST-AISL-${tipo}-${sufijo}`,
            nombre: 'Integracion',
            apellido: `Prueba${tipo}`,
            correo: `aislamiento-${tipo}-${sufijo}@example.invalid`,
            rol_id: 3,
            ...(faenaId ? { faena_id: faenaId } : {}),
            contraseña_hash: 'NO_UTILIZABLE_SOLO_PRUEBAS',
            salt: 'SALT_SOLO_PRUEBAS',
            activo: true,
          },
          { transaction }
        );

      // El responsable se crea primero porque faenas.responsable_id
      // tiene una clave foránea hacia usuarios.id.
      const responsable = await crearTrabajador('responsable');

      const faenaEmpresa3 = await Faena.create(
        {
          nombre: `Faena temporal aislamiento ${sufijo}`,
          descripcion: 'Exclusiva de prueba transaccional',
          empresa_id: 3,
          ubicacion: 'Ubicacion de pruebas',
          responsable_id: responsable.id,
          activo: true,
        },
        { transaction }
      );

      const trabajador1 = await crearTrabajador(
        'empresa1',
        Number(faenaEmpresa1.get('id'))
      );

      const trabajador3 = await crearTrabajador(
        'empresa3',
        Number(faenaEmpresa3.get('id'))
      );

      const ids = [trabajador1.id, trabajador3.id];

      const consultaEmpresa = (empresaId: number) => ({
        where: {
          activo: true,
          id: { [Op.in]: ids },
        },
        include: [{
          model: Faena,
          as: 'faena',
          attributes: [],
          required: true,
          where: { empresa_id: empresaId },
        }],
        transaction,
      });

      const usuariosEmpresa1 = await Usuario.findAll(
        consultaEmpresa(1)
      );

      const usuariosEmpresa3 = await Usuario.findAll(
        consultaEmpresa(3)
      );

      expect(usuariosEmpresa1.map(usuario => usuario.id))
        .toEqual([trabajador1.id]);

      expect(usuariosEmpresa3.map(usuario => usuario.id))
        .toEqual([trabajador3.id]);

      const conteoEmpresa1 = await Usuario.count(
        consultaEmpresa(1)
      );

      const conteoEmpresa3 = await Usuario.count(
        consultaEmpresa(3)
      );

      expect(conteoEmpresa1).toBe(1);
      expect(conteoEmpresa3).toBe(1);

      const usuarioAjeno = await Usuario.findByPk(
        trabajador3.id,
        {
          include: [{
            model: Faena,
            as: 'faena',
            attributes: [],
            required: true,
            where: { empresa_id: 1 },
          }],
          transaction,
        }
      );

      expect(usuarioAjeno).toBeNull();

      console.log('✅ Listados aislados entre empresas.');
      console.log('✅ Conteos aislados entre empresas.');
      console.log('✅ Búsqueda individual ajena rechazada.');
    } finally {
      if (!transaction.finished) {
        await transaction.rollback();
        console.log('✅ ROLLBACK ejecutado.');
      }
    }
  });
});
