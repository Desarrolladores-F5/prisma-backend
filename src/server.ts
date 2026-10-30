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

sequelize
  .authenticate()
  .then(() => {
    console.log('✅ Conexión a la base de datos establecida correctamente.');
    return sequelize.sync();
  })
  .then(() => {
    console.log('✅ Modelos sincronizados');

    app.listen(PORT, () => {
      console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((error: any) => {
    console.error('❌ Error al iniciar el servidor:', error);
  });
