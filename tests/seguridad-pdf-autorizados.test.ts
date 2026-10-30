import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Modelos simulados: no se conecta a MySQL.
vi.mock('../src/models', () => ({
  RespuestaFormulario: {
    findByPk: vi.fn(),
  },
  Usuario: {},
  Formulario: {},
}));

// PDFKit simulado: no genera archivos reales.
vi.mock('pdfkit', () => ({
  default: vi.fn().mockImplementation(function PDFDocumentSimulado() {
    const doc: any = {};

    doc.pipe = vi.fn(() => doc);
    doc.fontSize = vi.fn(() => doc);
    doc.text = vi.fn(() => doc);
    doc.moveDown = vi.fn(() => doc);
    doc.image = vi.fn(() => doc);
    doc.end = vi.fn(() => doc);
    doc.page = { height: 800, width: 600 };

    return doc;
  }),
}));

// Sistema de archivos simulado.
vi.mock('fs', () => {
  const stream: any = {};

  stream.on = vi.fn((evento: string, callback: () => void) => {
    if (evento === 'finish') {
      queueMicrotask(callback);
    }

    return stream;
  });

  return {
    default: {
      createWriteStream: vi.fn(() => stream),
      unlinkSync: vi.fn(),
      existsSync: vi.fn(() => false),
    },
  };
});

import PDFDocument from 'pdfkit';
import fs from 'fs';
import { RespuestaFormulario } from '../src/models';
import { validarToken } from '../src/middlewares/validarToken';
import { descargarPDFRespuesta } from '../src/controllers/respuesta_formulario.controller';

describe('Seguridad - descargas PDF autorizadas', () => {
  const secreto = 'clave-exclusiva-pruebas-prisma-pdf-autorizados';
  const secretoAnterior = process.env.JWT_SECRET;

  const app = express();
  const descargaSimulada = vi.fn();

  // Simulamos exclusivamente la transferencia del archivo.
  app.use((_req, res, next) => {
    res.download = ((
      _ruta: string,
      nombre: string,
      callback?: (error?: Error) => void
    ) => {
      descargaSimulada(nombre);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${nombre}"`
      );

      res.status(200).send(Buffer.from('%PDF-1.4 SIMULADO'));

      if (callback) callback();

      return res;
    }) as typeof res.download;

    next();
  });

  app.get(
    '/api/respuestas-formulario/pdf/:id',
    validarToken,
    descargarPDFRespuesta
  );

  const token = (id: number, rol_id: number) =>
    jwt.sign({ id, rol_id }, secreto, { expiresIn: '1h' });

  const respuestaSimulada = {
    id: 25,
    usuario_id: 12,
    respuestas_json: { conforme: true },
    fecha_respuesta: new Date(),
    usuario: {
      nombre: 'Usuario',
      apellido: 'Prueba',
    },
    formulario: {
      nombre: 'Formulario de prueba',
    },
  };

  beforeEach(() => {
    process.env.JWT_SECRET = secreto;
    vi.clearAllMocks();
  });

  afterAll(() => {
    if (secretoAnterior === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = secretoAnterior;
    }
  });

  it('permite descargar al propietario de la respuesta', async () => {
    vi.mocked(RespuestaFormulario.findByPk)
      .mockResolvedValueOnce(respuestaSimulada as any);

    const resultado = await request(app)
      .get('/api/respuestas-formulario/pdf/25')
      .set('Authorization', `Bearer ${token(12, 3)}`);

    expect(resultado.status).toBe(200);
    expect(PDFDocument).toHaveBeenCalledTimes(1);
    expect(descargaSimulada).toHaveBeenCalledWith(
      'respuesta_formulario_25.pdf'
    );
    expect(fs.createWriteStream).toHaveBeenCalledTimes(1);
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it('permite descargar al administrador', async () => {
    vi.mocked(RespuestaFormulario.findByPk)
      .mockResolvedValueOnce(respuestaSimulada as any);

    const resultado = await request(app)
      .get('/api/respuestas-formulario/pdf/25')
      .set('Authorization', `Bearer ${token(1, 1)}`);

    expect(resultado.status).toBe(200);
    expect(PDFDocument).toHaveBeenCalledTimes(1);
    expect(descargaSimulada).toHaveBeenCalledWith(
      'respuesta_formulario_25.pdf'
    );
    expect(fs.createWriteStream).toHaveBeenCalledTimes(1);
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });
});
