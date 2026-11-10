// src/scripts/procesarAlertasAcreditacionesExternas.ts

/**
 * Punto de entrada seguro para el procesamiento
 * de acreditaciones documentales externas.
 *
 * Esta versión permite únicamente SIMULACIÓN.
 * No realiza escrituras ni genera notificaciones.
 *
 * La autorización de producción será implementada
 * durante el despliegue, después de verificar
 * permisos, respaldos y aislamiento multiempresa.
 */

const argumentosPermitidos: string[] = [];

const verificarConfiguracion = (): void => {
  const argumentos = process.argv.slice(2);

  if (
    argumentos.some(
      argumento => !argumentosPermitidos.includes(argumento)
    )
  ) {
    throw new Error(
      'BLOQUEADO: este motor solo permite simulación sin argumentos.'
    );
  }

  const variables = [
    'DB_NAME',
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
  ] as const;

  for (const variable of variables) {
    if (!process.env[variable]?.trim()) {
      throw new Error(
        `BLOQUEADO: falta configurar ${variable}.`
      );
    }
  }

  if (process.env.DB_USER?.toLowerCase() === 'root') {
    throw new Error(
      'BLOQUEADO: no se permite utilizar root.'
    );
  }
};

const ejecutar = async (): Promise<void> => {
  // Verificar antes de importar módulos que
  // inicializan la conexión Sequelize.
  verificarConfiguracion();

  const { sequelize } = await import('../models');

  try {
    const {
      procesarVencimientosAcreditacionesExternas,
    } = await import(
      '../services/procesadorVencimientosAcreditacionesExternas.service'
    );

    console.log(
      'PRISMA - Simulación de acreditaciones externas'
    );

    const resultado =
      await procesarVencimientosAcreditacionesExternas({
        modo: 'simulacion',
        diasAviso: 30,
        tamanoLote: 100,
        maximoRegistros: 1000,
      });

    console.log(
      JSON.stringify(resultado, null, 2)
    );

    if (resultado.errores.length > 0) {
      throw new Error(
        'La simulación terminó con errores de procesamiento.'
      );
    }

    console.log(
      'Simulación finalizada sin escrituras.'
    );
  } finally {
    await sequelize.close();
  }
};

ejecutar().catch(error => {
  console.error(
    'Error en simulación de acreditaciones externas:',
    error instanceof Error
      ? error.message
      : 'Error desconocido.'
  );

  process.exitCode = 1;
});
