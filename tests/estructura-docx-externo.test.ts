import { describe, expect, it } from 'vitest';
import {
  validarEstructuraDocx,
} from '../src/services/validacionDocxExterno.service';

function crearZip(archivos: string[]): Buffer {
  const partesLocales: Buffer[] = [];
  const partesCentrales: Buffer[] = [];
  let desplazamiento = 0;

  for (const nombre of archivos) {
    const nombreBuffer = Buffer.from(nombre, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(nombreBuffer.length, 26);

    partesLocales.push(local, nombreBuffer);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(nombreBuffer.length, 28);
    central.writeUInt32LE(desplazamiento, 42);

    partesCentrales.push(central, nombreBuffer);
    desplazamiento += local.length + nombreBuffer.length;
  }

  const directorioCentral = Buffer.concat(partesCentrales);
  const final = Buffer.alloc(22);

  final.writeUInt32LE(0x06054b50, 0);
  final.writeUInt16LE(archivos.length, 8);
  final.writeUInt16LE(archivos.length, 10);
  final.writeUInt32LE(directorioCentral.length, 12);
  final.writeUInt32LE(desplazamiento, 16);

  return Buffer.concat([
    ...partesLocales,
    directorioCentral,
    final,
  ]);
}

describe('Seguridad - Estructura DOCX externa', () => {
  it('acepta un ZIP con las entradas esenciales de DOCX', async () => {
    const contenido = crearZip([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
    ]);

    await expect(validarEstructuraDocx(contenido))
      .resolves.toBeUndefined();
  });

  it('rechaza un ZIP común sin estructura DOCX', async () => {
    const contenido = crearZip(['archivo.txt']);

    await expect(validarEstructuraDocx(contenido))
      .rejects.toThrow('El archivo DOCX no tiene una estructura válida.');
  });

  it('rechaza un DOCX incompleto', async () => {
    const contenido = crearZip([
      '[Content_Types].xml',
      '_rels/.rels',
    ]);

    await expect(validarEstructuraDocx(contenido))
      .rejects.toThrow('El archivo DOCX no tiene una estructura válida.');
  });

  it('rechaza contenido ZIP corrupto', async () => {
    await expect(
      validarEstructuraDocx(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    ).rejects.toThrow('El archivo DOCX no tiene una estructura válida.');
  });

  it('rechaza archivos que superan el máximo permitido', async () => {
    await expect(
      validarEstructuraDocx(Buffer.alloc(10 * 1024 * 1024 + 1))
    ).rejects.toThrow('El archivo DOCX no tiene una estructura válida.');
  });
});
