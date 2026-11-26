import { describe, expect, it } from 'vitest';

import {
  ErrorPlantillaDocumental,
  validarPlantillaDocumental,
} from '../src/middlewares/plantillaDocumentalExterna';

function crearArchivo(
  nombre: string,
  contenido: Buffer
): Express.Multer.File {
  return {
    fieldname: 'archivo',
    originalname: nombre,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: contenido.length,
    buffer: contenido,
  } as Express.Multer.File;
}

describe('Seguridad - Plantillas documentales externas', () => {
  it('acepta un archivo PDF con firma válida', () => {
    const archivo = crearArchivo(
      'declaracion.pdf',
      Buffer.from('%PDF-1.7\ncontenido de prueba')
    );

    expect(validarPlantillaDocumental(archivo)).toBe('pdf');
  });

  it('acepta un archivo Word DOC con firma válida', () => {
    const archivo = crearArchivo(
      'formulario.doc',
      Buffer.from([
        0xd0, 0xcf, 0x11, 0xe0,
        0xa1, 0xb1, 0x1a, 0xe1,
        0x00,
      ])
    );

    expect(validarPlantillaDocumental(archivo)).toBe('doc');
  });

  it('acepta un archivo DOCX con cabecera ZIP', () => {
    const archivo = crearArchivo(
      'formulario.docx',
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])
    );

    expect(validarPlantillaDocumental(archivo)).toBe('docx');
  });

  it('rechaza extensiones no permitidas', () => {
    const archivo = crearArchivo(
      'programa.exe',
      Buffer.from('contenido')
    );

    expect(() => validarPlantillaDocumental(archivo))
      .toThrow(ErrorPlantillaDocumental);
  });

  it('rechaza archivos vacíos', () => {
    const archivo = crearArchivo('vacio.pdf', Buffer.alloc(0));

    expect(() => validarPlantillaDocumental(archivo))
      .toThrow('El archivo adjunto está vacío.');
  });

  it('rechaza un PDF con contenido que no corresponde', () => {
    const archivo = crearArchivo(
      'falso.pdf',
      Buffer.from('No soy un PDF')
    );

    expect(() => validarPlantillaDocumental(archivo))
      .toThrow('El contenido no corresponde al formato del archivo.');
  });

  it('rechaza nombres con rutas', () => {
    const archivo = crearArchivo(
      '../documento.pdf',
      Buffer.from('%PDF-1.7')
    );

    expect(() => validarPlantillaDocumental(archivo))
      .toThrow('El nombre del archivo adjunto no es válido.');
  });

  it('rechaza nombres con caracteres de control', () => {
    const archivo = crearArchivo(
      'documento\n.pdf',
      Buffer.from('%PDF-1.7')
    );

    expect(() => validarPlantillaDocumental(archivo))
      .toThrow('El nombre del archivo adjunto no es válido.');
  });
});
