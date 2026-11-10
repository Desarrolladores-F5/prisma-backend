// src/app.ts

import express from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();

// =====================================================
// ✅ ORÍGENES PERMITIDOS
// =====================================================

const allowedOrigins = [
  'http://localhost:3000',
  'https://prisma.upf5.com',
];

// =====================================================
// ✅ CONFIGURACIÓN GENERAL DE CORS
// =====================================================

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Permite peticiones sin Origin, por ejemplo:
    // curl, Postman o comunicaciones servidor a servidor.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
};

app.use(cors(corsOptions));

app.use(helmet());
app.use(express.json());

// =====================================================
// ✅ CORS PARA ARCHIVOS ESTÁTICOS
// Firmas, adjuntos, imágenes, etc.
// =====================================================

app.use('/uploads', (req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
  res.setHeader(
    'Cross-Origin-Resource-Policy',
    'cross-origin'
  );

  next();
});

// 🔒 Las constancias documentales no se publican como archivos estáticos.
// Su descarga deberá realizarse mediante una ruta autenticada y autorizada.
app.use('/uploads/confirmaciones', (_req, res) => {
  res.status(403).json({
    mensaje: 'Acceso directo a constancias documentales no permitido.',
  });
});

app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'))
);

// =====================================================
// ✅ IMPORTAR RUTAS
// =====================================================

import auditoriaRoutes from './routes/auditoria.routes';
import authRoutes from './routes/auth.routes';
import capacitacionRoutes from './routes/capacitacion.routes';
import comentarioRoutes from './routes/comentario.routes';
import contratoExternoRoutes from './routes/contratosExternos.routes';
import documentoRoutes from './routes/documento.routes';
import empresaRoutes from './routes/empresa.routes';
import eppRoutes from './routes/epp.routes';
import estadisticaRoutes from './routes/estadistica.routes';
import faenaRoutes from './routes/faena.routes';
import firmaRoutes from './routes/firma_digital.routes';
import formularioRoutes from './routes/formulario.routes';
import historialCambioRoutes from './routes/historial_cambio.routes';
import inspeccionRoutes from './routes/inspeccion.routes';
import medidaRoutes from './routes/medida_correctiva.routes';
import notificacionRoutes from './routes/notificacion.routes';
import reporteRoutes from './routes/reporte.routes';
import respuestaFormularioRoutes from './routes/respuesta_formulario.routes';
import rolRoutes from './routes/rol.routes';
import uploadRoutes from './routes/upload.routes';
import usuarioRoutes from './routes/usuario.routes';
import examenRoutes from './routes/examen.routes';
import preguntaExamenRoutes from './routes/pregunta_examen.routes';
import respuestaExamenRoutes from './routes/respuesta_examen.routes';
import relDocumentoUsuarioRoutes from './routes/rel_documentos_usuarios.routes';

// =====================================================
// ✅ ASOCIAR RUTAS
// =====================================================

app.use('/api/auditorias', auditoriaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/capacitaciones', capacitacionRoutes);
app.use('/api/comentarios', comentarioRoutes);
app.use('/api/contratos-externos', contratoExternoRoutes);
app.use('/api/documentos', documentoRoutes);
app.use('/api/empresas', empresaRoutes);
app.use('/api/epp', eppRoutes);
app.use('/api/estadisticas', estadisticaRoutes);
app.use('/api/faenas', faenaRoutes);
app.use('/api/firmas', firmaRoutes);
app.use('/api/formularios', formularioRoutes);
app.use('/api/historial-cambios', historialCambioRoutes);
app.use('/api/inspecciones', inspeccionRoutes);
app.use('/api/medidas', medidaRoutes);
app.use('/api/notificaciones', notificacionRoutes);
app.use('/api/reportes', reporteRoutes);
app.use('/api/respuestas-formulario', respuestaFormularioRoutes);
app.use('/api/roles', rolRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/examenes', examenRoutes);
app.use('/api/preguntas-examen', preguntaExamenRoutes);
app.use('/api/respuestas-examen', respuestaExamenRoutes);

// =====================================================
// ✅ RELACIONES DOCUMENTO - USUARIO
// =====================================================

app.use(
  '/api/rel-documentos-usuarios',
  relDocumentoUsuarioRoutes
);

// =====================================================
// ✅ RUTA RAÍZ
// =====================================================

app.get('/', (_req, res) => {
  res.send('🚀 Backend Prisma funcionando');
});

export default app;
