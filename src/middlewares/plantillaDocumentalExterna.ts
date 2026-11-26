import multer from 'multer';
import { validarEstructuraDocx } from '../services/validacionDocxExterno.service';

export const TAMANO_MAXIMO_PLANTILLA = 10 * 1024 * 1024;

export const recibirPlantillaDocumental = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TAMANO_MAXIMO_PLANTILLA,
    files: 1,
    fields: 1,
    parts: 2,
    fieldSize: 1024,
  },
}).single('archivo');

export type ExtensionPlantilla = 'pdf' | 'doc' | 'docx';

export class ErrorPlantillaDocumental extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorPlantillaDocumental';
  }
}

export function validarPlantillaDocumental(
  archivo: Express.Multer.File
): ExtensionPlantilla {
  if (!archivo.buffer || archivo.buffer.length === 0) {
    throw new ErrorPlantillaDocumental(
      400,
      'El archivo adjunto está vacío.'
    );
  }

  const nombre = archivo.originalname;

  if (
    !nombre ||
    nombre.length > 255 ||
    /[\\/\x00-\x1f\x7f]/.test(nombre)
  ) {
    throw new ErrorPlantillaDocumental(
      400,
      'El nombre del archivo adjunto no es válido.'
    );
  }

  const extension = nombre.split('.').pop()?.toLowerCase();

  if (
    extension !== 'pdf' &&
    extension !== 'doc' &&
    extension !== 'docx'
  ) {
    throw new ErrorPlantillaDocumental(
      400,
      'Solo se permiten archivos PDF o Word.'
    );
  }

  const contenido = archivo.buffer;

  const esPdf =
    contenido.subarray(0, 5).toString('ascii') === '%PDF-';

  const esDoc =
    contenido.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );

  const esZip =
    contenido.length >= 4 &&
    contenido[0] === 0x50 &&
    contenido[1] === 0x4b &&
    contenido[2] === 0x03 &&
    contenido[3] === 0x04;

  if (
    (extension === 'pdf' && !esPdf) ||
    (extension === 'doc' && !esDoc) ||
    (extension === 'docx' && !esZip)
  ) {
    throw new ErrorPlantillaDocumental(
      400,
      'El contenido no corresponde al formato del archivo.'
    );
  }

  return extension;
}


/**
 * Validación completa para utilizar antes de almacenar un adjunto.
 * Mantiene la validación original y refuerza los documentos DOCX.
 */
export async function validarPlantillaDocumentalCompleta(
  archivo: Express.Multer.File
): Promise<ExtensionPlantilla> {
  const extension = validarPlantillaDocumental(archivo);

  if (extension === 'docx') {
    try {
      await validarEstructuraDocx(archivo.buffer);
    } catch {
      throw new ErrorPlantillaDocumental(
        400,
        'El archivo DOCX no tiene una estructura válida.'
      );
    }
  }

  return extension;
}
