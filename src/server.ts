// src/server.ts
import dotenv from 'dotenv';

dotenv.config();

import sequelize from './config/database';
import './models';
import app from './app';

// =====================================================
// PUERTO Y CONEXIÓN A BASE DE DATOS
// =====================================================

const PORT = process.env.PORT || 3001;

// =====================================================
// INICIO SEGURO DEL SERVIDOR
// =====================================================

const iniciarServidor = async (): Promise<void> => {
  try {
    // Verificar la conexión sin modificar la estructura de MySQL.
    await sequelize.authenticate();

    console.log(
      '✅ Conexión a la base de datos establecida correctamente.'
    );

    // Las tablas y sus restricciones se administran mediante
    // migraciones SQL controladas.
    // No ejecutar sequelize.sync() durante el inicio del servidor.

    console.log(
      '✅ Modelos registrados. Sincronización automática deshabilitada.'
    );

    app.listen(PORT, () => {
      console.log(
        `✅ Servidor escuchando en http://localhost:${PORT}`
      );
    });
  } catch (error: unknown) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exitCode = 1;
  }
};

void iniciarServidor();
