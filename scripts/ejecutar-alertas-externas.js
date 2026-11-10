'use strict';

// scripts/ejecutar-alertas-externas.js
//
// Ejecutor seguro de acreditaciones documentales externas.
//
// Versión inicial:
// - Solo permite simulación.
// - No acepta argumentos de escritura.
// - No utiliza credenciales predeterminadas.
// - No modifica el motor de EPP.
// - No habilita escrituras de producción.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const proyecto = path.resolve(__dirname, '..');

const motor = path.join(
  proyecto,
  'dist',
  'scripts',
  'procesarAlertasAcreditacionesExternas.js'
);

function ejecutar() {
  if (process.argv.length !== 2) {
    throw new Error(
      'BLOQUEADO: este ejecutor no acepta argumentos.'
    );
  }

  if (!fs.existsSync(motor)) {
    throw new Error(
      'Motor de acreditaciones externas no compilado.'
    );
  }

  if (
    !process.env.DB_NAME ||
    !process.env.DB_HOST ||
    !process.env.DB_USER ||
    !process.env.DB_PASSWORD
  ) {
    throw new Error(
      'BLOQUEADO: configuración MySQL incompleta.'
    );
  }

  if (process.env.DB_USER === 'root') {
    throw new Error(
      'BLOQUEADO: no se permite utilizar root.'
    );
  }

  const resultado = spawnSync(
    process.execPath,
    [motor],
    {
      cwd: proyecto,
      env: {
        ...process.env,
        PRISMA_ALERTAS_EXTERNAS_PRODUCCION: '',
      },
      stdio: 'inherit',
      timeout: 120000,
    }
  );

  if (resultado.error) {
    throw resultado.error;
  }

  if (resultado.status !== 0) {
    throw new Error(
      `El procesador terminó con código ${resultado.status}.`
    );
  }

  console.log(
    '✅ Simulación de alertas externas finalizada.'
  );
}

try {
  ejecutar();
} catch (error) {
  console.error('❌', error.message);
  process.exitCode = 1;
}
