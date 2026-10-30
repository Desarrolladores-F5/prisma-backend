import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';

export const generarPDFConfirmacion = async ({
  documento,
  usuario,
  fecha,
  documentoId,
  usuarioId,
}: {
  documento: {
    nombre: string;
    tipo: string;
    version?: string;
  };
  usuario: {
    nombre: string;
    apellido: string;
    correo: string;
    rut?: string;
    firma_imagen_url?: string;
  };
  fecha: Date;
  documentoId: number;
  usuarioId: number;
}): Promise<string> => {
  let archivoCreado: string | null = null;

  try {
    const outputDir = path.join(__dirname, '../../uploads/confirmaciones');
    fs.mkdirSync(outputDir, { recursive: true });

    const filename = `confirmacion_doc_${documentoId}_usuario_${usuarioId}_${Date.now()}_${randomUUID()}.pdf`;
    const outputPath = path.join(outputDir, filename);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const writeStream = fs.createWriteStream(outputPath);
    archivoCreado = outputPath;
    doc.pipe(writeStream);

    // ✅ Título centrado
    doc.fontSize(18).text('Constancia de Recepción de Documento', { align: 'center' });
    doc.moveDown(1.5);

    // ✅ Información principal del documento
    doc.fontSize(12).text(`Nombre: ${usuario.nombre} ${usuario.apellido}`);
    doc.text(`Correo: ${usuario.correo}`);
    doc.text(`Documento: ${documento.nombre}`);
    doc.text(`Tipo: ${documento.tipo}`);
    if (documento.version) doc.text(`Versión: ${documento.version}`);
    doc.text(`Fecha de recepción: ${fecha.toLocaleString()}`);
    doc.moveDown();
    doc.text('Declaro haber recibido, leído y comprendido el documento señalado.');
    doc.moveDown(26); // Más espacio para dejar la firma bien abajo

    // ✅ Firma primero, luego nombre y RUT
    if (usuario.firma_imagen_url) {
      const firmaPath = path.join(__dirname, '../../uploads/firmas', path.basename(usuario.firma_imagen_url));

      if (fs.existsSync(firmaPath)) {
        const firmaWidth = 380;
        const pageWidth = doc.page.width;
        const x = (pageWidth - firmaWidth) / 2;

        // Firma ampliada
        doc.image(firmaPath, x, doc.y, {
          fit: [firmaWidth, 160],
          align: 'center',
        });

        doc.moveDown(2.5);

        // Nombre y RUT
        doc.fontSize(12).text(`${usuario.nombre} ${usuario.apellido}`, { align: 'center' });
        if (usuario.rut) {
          doc.text(`RUT: ${usuario.rut}`, { align: 'center' });
        }
      } else {
        doc.moveDown(6);
        doc.fontSize(12).text('⚠️ Firma no encontrada.', { align: 'center' });
      }
    }

    doc.end();

    await new Promise<void>((resolve, reject) => {
      writeStream.once('finish', resolve);
      writeStream.once('error', reject);
      doc.once('error', reject);
    });

    return `/uploads/confirmaciones/${filename}`;
  } catch (error) {
    if (archivoCreado) {
      try {
        await fs.promises.unlink(archivoCreado);
      } catch (errorLimpieza) {
        console.error('No se pudo limpiar el PDF parcial:', errorLimpieza);
      }
    }

    console.error('❌ Error al generar PDF:', error);
    throw new Error('Error al generar constancia PDF');
  }
};
