// src/controllers/firma_digital.controller.ts
import { Request, Response } from 'express';
import { FirmaDigital, RespuestaFormulario, RelDocumentoUsuario } from '../models';

// ✅ Obtener todas las firmas digitales
export const obtenerFirmas = async (_req: Request, res: Response): Promise<void> => {
  try {
    const firmas = await FirmaDigital.findAll();
    res.json(firmas);
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al obtener firmas digitales', error });
  }
};

// ✅ Crear una nueva firma digital con soporte para imagen y asociación
export const crearFirma = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ mensaje: '❌ Body inválido: no se recibió información' });
      return;
    }

    const {
      firmante_id,
      hash_firma,
      tipo_firma,
      metadata,
      firma_imagen_url // Opcional
    } = req.body;

    if (!firmante_id || !hash_firma || !tipo_firma) {
      res.status(400).json({
        mensaje: '❌ Campos requeridos faltantes (firmante_id, hash_firma o tipo_firma)'
      });
      return;
    }

    const usuarioAutenticadoId = (req as any).usuario?.id;

    if (!usuarioAutenticadoId) {
      res.status(401).json({
        mensaje: 'Usuario no autenticado.',
      });
      return;
    }

    if (String(firmante_id) !== String(usuarioAutenticadoId)) {
      res.status(403).json({
        mensaje: 'No tienes autorización para registrar firmas de otro usuario.',
      });
      return;
    }

    console.log('📥 Datos de firma recibidos:', {
      firmante_id,
      hash_firma,
      tipo_firma,
      metadata,
      firma_imagen_url
    });

    const nuevaFirma = await FirmaDigital.create({
      firmante_id,
      hash_firma,
      tipo_firma,
      metadata,
      firma_imagen_url,
      fecha: new Date(),
    });

    // 🔁 Asociar con respuesta_formulario si aplica
    if (metadata?.entidad === 'respuesta_formulario' && metadata?.entidad_id) {
      const resultado = await RespuestaFormulario.update(
        { estado_firma: 'firmado' },
        { where: { id: metadata.entidad_id } }
      );

      if (resultado[0] > 0) {
        console.log(`✅ RespuestaFormulario ID ${metadata.entidad_id} actualizada`);
      } else {
        console.warn(`⚠️ No se encontró RespuestaFormulario con ID ${metadata.entidad_id}`);
      }
    }

    // 🔁 Asociar con documento si aplica
    if (metadata?.entidad === 'documento' && metadata?.entidad_id) {
      const actualizado = await RelDocumentoUsuario.update(
        {
          recepcionado: true,
          fecha_recepcion: new Date(),
        },
        {
          where: {
            documento_id: metadata.entidad_id,
            usuario_id: firmante_id
          }
        }
      );

      if (actualizado[0] > 0) {
        console.log(`✅ Documento ID ${metadata.entidad_id} marcado como recepcionado por usuario ${firmante_id}`);
      } else {
        console.warn(`⚠️ No se encontró relación documento-usuario para ID ${metadata.entidad_id}`);
      }
    }

    res.status(201).json(nuevaFirma);
  } catch (error) {
    console.error('❌ Error en crearFirma:', error);
    res.status(400).json({ mensaje: '❌ Error al crear firma digital', error });
  }
};

// ✅ Eliminar una firma digital
export const eliminarFirma = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const eliminada = await FirmaDigital.destroy({ where: { id } });

    if (eliminada) {
      res.json({ mensaje: '✅ Firma eliminada correctamente' });
    } else {
      res.status(404).json({ mensaje: 'Firma no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ mensaje: '❌ Error al eliminar firma digital', error });
  }
};
