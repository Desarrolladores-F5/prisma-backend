// tests/integration/trabajadores-contratos-externos.test.ts

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';

const BASE_PERMITIDA = 'prisma_test_empresas_externas';

describe('Integración MySQL - trabajadores de contratos externos', () => {
  it('valida pertenencia, duplicados y ROLLBACK', async () => {
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

    const {
      sequelize,
      Usuario,
      UsuarioEmpresaExterna,
      ContratoExterno,
      ContratoExternoTrabajador,
    } = await import('../../src/models');

    const {
      vincularTrabajadorContratoExterno,
    } = await import(
      '../../src/services/trabajadoresContratosExternos.service'
    );

    const sufijo = randomUUID().replace(/-/g, '').slice(0, 16);

    const identificadores = {
      contrato: 0,
      vinculacion: 0,
      usuarios: [] as number[],
    };

    try {
      // Verificar la conexión real ANTES de cualquier escritura.
      const bases = await sequelize.query<{ nombre: string }>(
        'SELECT DATABASE() AS nombre',
        { type: QueryTypes.SELECT }
      );

      if (bases[0]?.nombre !== BASE_PERMITIDA) {
        throw new Error('BLOQUEADO: conexión MySQL incorrecta.');
      }

      const transaction = await sequelize.transaction();

      try {
        const crearUsuario = async (tipo: string) => {
          const usuario = await Usuario.create(
            {
              rut: `TEST-VINC-${tipo}-${sufijo}`,
              nombre: 'Usuario',
              apellido: `Prueba${tipo}`,
              correo: `vinc-${tipo}-${sufijo}@example.invalid`,
              rol_id: 3,
              contraseña_hash: 'CREDENCIAL_NO_UTILIZABLE_SOLO_TEST',
              salt: 'SALT_SOLO_TEST',
              activo: true,
            },
            { transaction }
          );

          identificadores.usuarios.push(usuario.id);
          return usuario;
        };

        const administrador = await crearUsuario('admin');
        const trabajador = await crearUsuario('trabajador');
        const ajeno = await crearUsuario('ajeno');

        await UsuarioEmpresaExterna.create(
          {
            usuario_id: administrador.id,
            empresa_id: 3,
            perfil: 'administrador_externo',
            activo: true,
          },
          { transaction }
        );

        await UsuarioEmpresaExterna.create(
          {
            usuario_id: trabajador.id,
            empresa_id: 3,
            perfil: 'trabajador',
            activo: true,
          },
          { transaction }
        );

        await UsuarioEmpresaExterna.create(
          {
            usuario_id: ajeno.id,
            empresa_id: 1,
            perfil: 'trabajador',
            activo: true,
          },
          { transaction }
        );

        const contrato = await ContratoExterno.create(
          {
            mandante_empresa_id: 1,
            contratista_empresa_id: 3,
            faena_id: 3,
            nombre: `Contrato trabajadores test ${sufijo}`,
            estado: 'pendiente',
          },
          { transaction }
        );

        identificadores.contrato = contrato.id;

        const solicitud = {
          administradorId: administrador.id,
          contratoId: contrato.id,
          trabajadorId: trabajador.id,
          fechaIncorporacion: '2026-11-10',
          transaction,
        };

        const vinculacion =
          await vincularTrabajadorContratoExterno(solicitud);

        identificadores.vinculacion = vinculacion.id;

        expect(vinculacion.contrato_id).toBe(contrato.id);
        expect(vinculacion.usuario_id).toBe(trabajador.id);
        expect(vinculacion.activo).toBe(true);

        console.log('✅ Trabajador autorizado vinculado.');

        await expect(
          vincularTrabajadorContratoExterno({
            ...solicitud,
            trabajadorId: ajeno.id,
          })
        ).rejects.toMatchObject({ estadoHttp: 403 });

        console.log('✅ Trabajador de otra empresa rechazado.');

        await expect(
          vincularTrabajadorContratoExterno(solicitud)
        ).rejects.toMatchObject({ estadoHttp: 409 });

        console.log('✅ Vinculación duplicada rechazada.');
      } finally {
        if (!transaction.finished) {
          await transaction.rollback();
          console.log('✅ ROLLBACK ejecutado.');
        }
      }

      const contratoResidual = await ContratoExterno.findByPk(
        identificadores.contrato
      );

      const vinculacionResidual =
        await ContratoExternoTrabajador.findByPk(
          identificadores.vinculacion
        );

      const usuariosResiduales = await Usuario.count({
        where: { id: identificadores.usuarios },
      });

      const pertenenciasResiduales =
        await UsuarioEmpresaExterna.count({
          where: { usuario_id: identificadores.usuarios },
        });

      expect(contratoResidual).toBeNull();
      expect(vinculacionResidual).toBeNull();
      expect(usuariosResiduales).toBe(0);
      expect(pertenenciasResiduales).toBe(0);

      console.log('✅ Cero registros ficticios residuales.');
    } finally {
      await sequelize.close();
    }
  }, 60000);
});
