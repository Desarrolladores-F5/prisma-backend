import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const resolverDirectorioConstancias = (): string => {
  const directorioPruebas = process.env.PRISMA_PDF_TEST_DIR;

  if (directorioPruebas !== undefined) {
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.DB_NAME !== 'prisma_test_documental'
    ) {
      throw new Error(
        'Directorio alternativo de constancias no autorizado.'
      );
    }

    if (
      !directorioPruebas.trim() ||
      !path.isAbsolute(directorioPruebas)
    ) {
      throw new Error(
        'El directorio de pruebas debe ser una ruta absoluta.'
      );
    }

    const directorio = path.resolve(directorioPruebas);
    const temporal = path.resolve(os.tmpdir());
    const relativo = path.relative(temporal, directorio);

    if (
      !relativo ||
      relativo === '..' ||
      relativo.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativo)
    ) {
      throw new Error(
        'Las constancias de prueba deben almacenarse dentro del directorio temporal.'
      );
    }

    // Validar enlaces simbólicos dentro del directorio temporal.
    // Se respeta la resolución legítima /var -> /private/var de macOS.
    const temporalReal = fs.realpathSync(temporal);
    const componentes = relativo.split(path.sep).filter(Boolean);

    let rutaActual = temporalReal;

    for (const componente of componentes) {
      rutaActual = path.join(rutaActual, componente);

      try {
        const informacion = fs.lstatSync(rutaActual);

        if (informacion.isSymbolicLink()) {
          throw new Error(
            'Directorio de constancias de prueba no autorizado: enlace simbólico.'
          );
        }

        if (!informacion.isDirectory()) {
          throw new Error(
            'La ruta de constancias de prueba contiene un elemento que no es directorio.'
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          break;
        }

        throw error;
      }
    }

    return directorio;
  }

  return path.resolve(__dirname, '../../uploads/confirmaciones');
};

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
  let writeStream: fs.WriteStream | null = null;
  let aperturaConfirmada = false;

  try {
    const outputDir = resolverDirectorioConstancias();
    fs.mkdirSync(outputDir, { recursive: true });

    const filename =
      `confirmacion_doc_${documentoId}_usuario_${usuarioId}_${Date.now()}_${randomUUID()}.pdf`;

    const outputPath = path.join(outputDir, filename);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    writeStream = fs.createWriteStream(outputPath, {
      flags: 'wx',
      mode: 0o600,
    });

    archivoCreado = outputPath;

    writeStream.once('open', () => {
      aperturaConfirmada = true;
    });

    await new Promise<void>((resolve, reject) => {
      let finalizado = false;

      const resolver = () => {
        if (finalizado) return;
        finalizado = true;
        resolve();
      };

      const rechazar = (error: Error) => {
        if (finalizado) return;
        finalizado = true;
        reject(error);
      };

      writeStream!.once('finish', resolver);
      writeStream!.once('error', rechazar);
      doc.once('error', rechazar);

      try {
        doc.pipe(writeStream!);

        doc.fontSize(18).text(
          'Constancia de Recepción de Documento',
          { align: 'center' }
        );

        doc.moveDown(1.5);

        doc.fontSize(12).text(
          `Nombre: ${usuario.nombre} ${usuario.apellido}`
        );

        doc.text(`Correo: ${usuario.correo}`);
        doc.text(`Documento: ${documento.nombre}`);
        doc.text(`Tipo: ${documento.tipo}`);

        if (documento.version) {
          doc.text(`Versión: ${documento.version}`);
        }

        doc.text(
          `Fecha de recepción: ${fecha.toLocaleString()}`
        );

        doc.moveDown();

        doc.text(
          'Declaro haber recibido, leído y comprendido el documento señalado.'
        );

        doc.moveDown(26);

        if (usuario.firma_imagen_url) {
          const firmaPath = path.join(
            __dirname,
            '../../uploads/firmas',
            path.basename(usuario.firma_imagen_url)
          );

          if (fs.existsSync(firmaPath)) {
            const firmaWidth = 380;
            const pageWidth = doc.page.width;
            const x = (pageWidth - firmaWidth) / 2;

            doc.image(firmaPath, x, doc.y, {
              fit: [firmaWidth, 160],
              align: 'center',
            });

            doc.moveDown(2.5);

            doc.fontSize(12).text(
              `${usuario.nombre} ${usuario.apellido}`,
              { align: 'center' }
            );

            if (usuario.rut) {
              doc.text(`RUT: ${usuario.rut}`, {
                align: 'center',
              });
            }
          } else {
            doc.moveDown(6);
            doc.fontSize(12).text(
              '⚠️ Firma no encontrada.',
              { align: 'center' }
            );
          }
        }

        doc.end();
      } catch (error) {
        rechazar(
          error instanceof Error
            ? error
            : new Error(String(error))
        );
      }
    });

    return `/uploads/confirmaciones/${filename}`;
  } catch (error) {
    if (writeStream && !writeStream.destroyed) {
      writeStream.destroy();
    }

    if (archivoCreado && aperturaConfirmada) {
      try {
        await fs.promises.unlink(archivoCreado);
      } catch (errorLimpieza) {
        console.error(
          'No se pudo limpiar el PDF parcial:',
          errorLimpieza
        );
      }
    }

    console.error('❌ Error al generar PDF:', error);

    throw new Error('Error al generar constancia PDF');
  }
};
