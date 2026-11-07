'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const proyecto = path.resolve(__dirname, '..');

const motor = path.join(
  proyecto,
  'dist',
  'scripts',
  'procesarAlertasVencimiento.js'
);

const credencial = path.join(
  os.homedir(),
  '.config',
  'prisma',
  'alertas-mysql-password'
);

function ejecutar() {
  if (!fs.existsSync(motor)) {
    throw new Error('Motor no compilado. Ejecutar npm run build.');
  }

  const password = fs.readFileSync(credencial, 'utf8').trim();

  if (!password) {
    throw new Error('No existe una contraseña válida para prisma_alertas.');
  }

  // Por defecto se ejecuta exclusivamente en simulación.
  // La activación real se configurará durante el despliegue.
  const resultado = spawnSync(
    process.execPath,
    [motor],
    {
      cwd: proyecto,
      env: {
        ...process.env,
        DB_HOST: '127.0.0.1',
        DB_NAME: 'Prisma',
        DB_USER: 'prisma_alertas',
        DB_PASSWORD: password,
        PRISMA_ALERTAS_PRODUCCION: ''
      },
      stdio: 'inherit',
      timeout: 120000
    }
  );

  if (resultado.error) {
    throw resultado.error;
  }

  if (resultado.status !== 0) {
    throw new Error(
      `El motor terminó con código ${resultado.status}.`
    );
  }

  console.log('✅ Ejecución segura finalizada.');
}

try {
  ejecutar();
} catch (error) {
  console.error('❌', error.message);
  process.exitCode = 1;
}
