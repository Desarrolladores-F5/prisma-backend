import yauzl from 'yauzl';

const ENTRADAS_REQUERIDAS = new Set([
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
]);

const MAXIMO_ENTRADAS = 1000;
const MAXIMO_DESCOMPRIMIDO = 100 * 1024 * 1024;

export class ErrorEstructuraDocx extends Error {
  constructor(mensaje = 'El archivo DOCX no tiene una estructura válida.') {
    super(mensaje);
    this.name = 'ErrorEstructuraDocx';
  }
}

/**
 * Comprueba la estructura ZIP de un documento DOCX sin extraer archivos.
 *
 * Esta validación comprueba las entradas centrales del paquete.
 * No constituye un análisis antivirus ni una validación exhaustiva
 * del contenido XML.
 */
export function validarEstructuraDocx(
  contenido: Buffer
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (contenido.length === 0 || contenido.length > 10 * 1024 * 1024) {
      reject(new ErrorEstructuraDocx());
      return;
    }

    yauzl.fromBuffer(
      contenido,
      {
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, archivoZip) => {
        if (error || !archivoZip) {
          reject(new ErrorEstructuraDocx());
          return;
        }

        let finalizado = false;
        let cantidad = 0;
        let tamanoTotal = 0;

        const encontradas = new Set<string>();

        const fallar = () => {
          if (finalizado) return;
          finalizado = true;
          archivoZip.close();
          reject(new ErrorEstructuraDocx());
        };

        archivoZip.on('error', fallar);

        archivoZip.on('entry', entrada => {
          if (finalizado) return;

          cantidad += 1;
          tamanoTotal += entrada.uncompressedSize;

          if (
            cantidad > MAXIMO_ENTRADAS ||
            tamanoTotal > MAXIMO_DESCOMPRIMIDO
          ) {
            fallar();
            return;
          }

          if (ENTRADAS_REQUERIDAS.has(entrada.fileName)) {
            encontradas.add(entrada.fileName);
          }

          archivoZip.readEntry();
        });

        archivoZip.on('end', () => {
          if (finalizado) return;
          finalizado = true;

          if (
            [...ENTRADAS_REQUERIDAS].every(
              nombre => encontradas.has(nombre)
            )
          ) {
            resolve();
          } else {
            reject(new ErrorEstructuraDocx());
          }
        });

        archivoZip.readEntry();
      }
    );
  });
}
