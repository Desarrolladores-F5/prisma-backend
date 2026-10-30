// src/controllers/respuesta_formulario.controller.ts
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { RespuestaFormulario, Usuario, Formulario } from '../models';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

// ✅ Crear una nueva respuesta de formulario
export const crearRespuestaFormulario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { formulario_id, respuestas_json } = req.body;

    if (!formulario_id || !respuestas_json) {
      res.status(400).json({ mensaje: '❌ formulario_id y respuestas_json son obligatorios.' });
      return;
    }

    const token = req.headers.authorization?.split(' ')[1];
    let usuario_id: number | undefined;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto_prisma') as any;
        usuario_id = decoded?.id;
      } catch (err) {
        console.error('❌ Token inválido al registrar respuesta:', err);
        res.status(401).json({ mensaje: '❌ Token inválido' });
        return;
      }
    }

    const nueva = await RespuestaFormulario.create({
      formulario_id,
      usuario_id,
      respuestas_json,
    });

    res.status(201).json({
      mensaje: '✅ Respuesta registrada correctamente.',
      id: nueva.id,
    });
  } catch (error) {
    console.error('❌ Error al guardar la respuesta:', error);
    res.status(500).json({ mensaje: '❌ Error al guardar la respuesta del formulario.', error });
  }
};

// ✅ Obtener todas las respuestas activas
export const obtenerRespuestasFormulario = async (_req: Request, res: Response): Promise<void> => {
  try {
    const respuestas = await RespuestaFormulario.findAll({ where: { activo: true } });
    res.json(respuestas);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener respuestas', error });
  }
};

// ✅ Obtener respuestas por formulario_id
export const obtenerRespuestasPorFormulario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { formulario_id } = req.query;

    if (!formulario_id) {
      res.status(400).json({ mensaje: '⚠️ Debes proporcionar un formulario_id como query param' });
      return;
    }

    const respuestas = await RespuestaFormulario.findAll({
      where: {
        formulario_id: Number(formulario_id),
        activo: true,
      },
      include: [
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['id', 'nombre', 'apellido', 'firma_imagen_url'],
        },
      ],
      order: [['fecha_respuesta', 'DESC']],
    });

    res.json(respuestas);
  } catch (error) {
    console.error('❌ Error al obtener respuestas por formulario:', error);
    res.status(500).json({ mensaje: '❌ Error al obtener respuestas', error });
  }
};

// ✅ Obtener una respuesta por ID
export const obtenerRespuestaPorId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const respuesta = await RespuestaFormulario.findByPk(id, {
      include: [
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['id', 'nombre', 'apellido', 'firma_imagen_url'],
        },
      ],
    });

    if (!respuesta) {
      res.status(404).json({ mensaje: '❌ Respuesta no encontrada' });
      return;
    }

    const usuarioAutenticado = (req as any).usuario;

    if (!usuarioAutenticado?.id) {
      res.status(401).json({ mensaje: 'Usuario no autenticado.' });
      return;
    }

    const esAdministrador = Number(usuarioAutenticado.rol_id) === 1;

    if (
      !esAdministrador &&
      (
        respuesta.usuario_id == null ||
        String(respuesta.usuario_id) !== String(usuarioAutenticado.id)
      )
    ) {
      res.status(403).json({
        mensaje: 'No tienes autorización para consultar esta respuesta.',
      });
      return;
    }

    res.json(respuesta);
  } catch (error) {
    console.error('❌ Error al obtener la respuesta por ID:', error);
    res.status(500).json({ mensaje: '❌ Error interno del servidor' });
  }
};

// ✅ Obtener respuestas del usuario autenticado
export const obtenerMisRespuestasFormulario = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      res.status(401).json({ mensaje: '❌ Token no proporcionado' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto_prisma') as any;
    const usuario_id = decoded?.id;

    if (!usuario_id) {
      res.status(401).json({ mensaje: '❌ Usuario no autenticado' });
      return;
    }

    const respuestas = await RespuestaFormulario.findAll({
      where: { usuario_id, activo: true },
      include: [
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['id', 'nombre', 'apellido', 'firma_imagen_url'],
        },
      ],
      order: [['fecha_respuesta', 'DESC']],
    });

    res.json(respuestas);
  } catch (error) {
    console.error('❌ Error al obtener respuestas del usuario:', error);
    res.status(500).json({ mensaje: '❌ Error interno del servidor' });
  }
};

// ✅ Descargar PDF con firma y nombre del formulario
export const descargarPDFRespuesta = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const respuesta = await RespuestaFormulario.findByPk(id, {
      include: [
        {
          model: Usuario,
          as: 'usuario',
          attributes: ['id', 'nombre', 'apellido', 'firma_imagen_url'],
        },
        {
          model: Formulario,
          as: 'formulario',
          attributes: ['id', 'nombre'],
        },
      ],
    });

    if (!respuesta) {
      res.status(404).json({ mensaje: '❌ Respuesta no encontrada' });
      return;
    }

    const usuarioAutenticado = (req as any).usuario;

    if (!usuarioAutenticado?.id) {
      res.status(401).json({ mensaje: 'Usuario no autenticado.' });
      return;
    }

    const esAdministrador = Number(usuarioAutenticado.rol_id) === 1;

    if (
      !esAdministrador &&
      (
        respuesta.usuario_id == null ||
        String(respuesta.usuario_id) !== String(usuarioAutenticado.id)
      )
    ) {
      res.status(403).json({
        mensaje: 'No tienes autorización para descargar esta respuesta.',
      });
      return;
    }

    const doc = new PDFDocument({ margin: 50 });
    const pdfPath = path.join(__dirname, `../../temp/resp_formulario_${respuesta.id}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const nombreFormulario = respuesta.formulario?.nombre || 'Formulario sin nombre';
    doc.fontSize(18).text(`${nombreFormulario}`, { align: 'center' }).moveDown(1.5);

    doc.fontSize(12)
      .text(`ID Respuesta: ${respuesta.id}`)
      .text(`Usuario: ${respuesta.usuario?.nombre} ${respuesta.usuario?.apellido}`)
      .text(`Fecha: ${new Date(respuesta.fecha_respuesta).toLocaleString('es-CL')}`)
      .moveDown();

    doc.fontSize(14).text('Respuestas:', { underline: true }).moveDown(0.5);
    doc.fontSize(12);

    for (const [pregunta, valor] of Object.entries(respuesta.respuestas_json || {})) {
      let textoRespuesta = '';

      if (typeof valor === 'boolean') {
        textoRespuesta = valor ? '✅ Sí' : '❌ No';
      } else if (typeof valor === 'object') {
        textoRespuesta = JSON.stringify(valor);
      } else {
        textoRespuesta = String(valor);
      }

      doc.text(`• ${pregunta}: ${textoRespuesta}`);
    }

    // Firma (centrada al pie)
    if (respuesta.usuario?.firma_imagen_url) {
      const firmaRelativa = respuesta.usuario.firma_imagen_url.startsWith('/')
        ? respuesta.usuario.firma_imagen_url
        : `/${respuesta.usuario.firma_imagen_url}`;
      const firmaPath = path.resolve(__dirname, `../../${firmaRelativa}`);

      if (fs.existsSync(firmaPath)) {
        const firmaY = doc.page.height - 140;

        doc.fontSize(12).text(
          `${respuesta.usuario.nombre} ${respuesta.usuario.apellido}`,
          50,
          firmaY,
          { align: 'center', width: doc.page.width - 100 }
        );

        doc.image(firmaPath, (doc.page.width - 220) / 2, firmaY + 18, {
          width: 220,
          height: 75,
        });
      } else {
        console.warn(`⚠️ Imagen de firma no encontrada en: ${firmaPath}`);
      }
    }

    doc.end();

    writeStream.on('finish', () => {
      res.download(pdfPath, `respuesta_formulario_${respuesta.id}.pdf`, (err) => {
        if (err) console.error('❌ Error al enviar PDF:', err);
        fs.unlinkSync(pdfPath);
      });
    });
  } catch (error) {
    console.error('❌ Error al generar PDF con firma:', error);
    res.status(500).json({ mensaje: '❌ Error interno al generar PDF con firma' });
  }
};
