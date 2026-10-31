import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';

vi.mock('pdfkit', () => ({
  default: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();

  return {
    ...original,
    default: {
      ...original,
      mkdirSync: vi.fn(),
      createWriteStream: vi.fn(),
      existsSync: vi.fn(),
      promises: {
        ...original.promises,
        unlink: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

import PDFDocument from 'pdfkit';
import fs from 'fs';
import { generarPDFConfirmacion } from '../src/utils/pdf';

function crearStreamSimulado() {
  return Object.assign(new EventEmitter(), {
    destroyed: false,
    destroy: vi.fn(function (this: any) {
      this.destroyed = true;
      return this;
    }),
  });
}

function prepararDocumentoSimulado(
  stream: ReturnType<typeof crearStreamSimulado>,
  evento: 'finish' | 'EEXIST'
) {
  const documentoPDF = {
    pipe: vi.fn(),
    once: vi.fn().mockReturnThis(),
    fontSize: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    moveDown: vi.fn().mockReturnThis(),
    end: vi.fn(() => {
      queueMicrotask(() => {
        if (evento === 'finish') {
          stream.emit('finish');
        } else {
          stream.emit(
            'error',
            Object.assign(
              new Error('El archivo ya existe'),
              { code: 'EEXIST' }
            )
          );
        }
      });
    }),
  };

  vi.mocked(PDFDocument).mockImplementationOnce(
    function DocumentoSimulado() {
      return documentoPDF as any;
    } as any
  );
}

function datosFicticios() {
  return {
    documento: {
      nombre: 'Procedimiento ficticio',
      tipo: 'Seguridad',
    },
    usuario: {
      nombre: 'Trabajador',
      apellido: 'Prueba',
      correo: 'prueba@example.test',
    },
    fecha: new Date('2026-10-30T12:00:00Z'),
    documentoId: 45,
    usuarioId: 12,
  };
}

describe('Creación exclusiva de constancias PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('impide sobrescrituras y enlaces simbólicos del archivo destino', async () => {
    const stream = crearStreamSimulado();

    vi.mocked(fs.createWriteStream).mockReturnValueOnce(stream as any);
    prepararDocumentoSimulado(stream, 'finish');

    await generarPDFConfirmacion(datosFicticios());

    const opciones = vi.mocked(fs.createWriteStream).mock.calls[0][1];

    expect(opciones).toBeDefined();

    const flags = (opciones as { flags?: number }).flags;

    expect(flags).toBe('wx');
    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  it('no elimina un archivo cuando falla su creación exclusiva', async () => {
    const stream = crearStreamSimulado();

    vi.mocked(fs.createWriteStream).mockReturnValueOnce(stream as any);
    prepararDocumentoSimulado(stream, 'EEXIST');

    await expect(
      generarPDFConfirmacion(datosFicticios())
    ).rejects.toThrow('Error al generar constancia PDF');

    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });
});

describe('Protección ante errores de apertura del PDF', () => {
  it('no elimina archivos cuando la apertura falla con EACCES', async () => {
    const stream = crearStreamSimulado();

    vi.mocked(fs.createWriteStream).mockReturnValueOnce(stream as any);

    const documentoPDF = {
      pipe: vi.fn(),
      once: vi.fn().mockReturnThis(),
      fontSize: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      moveDown: vi.fn().mockReturnThis(),
      end: vi.fn(() => {
        queueMicrotask(() => {
          stream.emit(
            'error',
            Object.assign(
              new Error('Permiso denegado al abrir el PDF'),
              { code: 'EACCES' }
            )
          );
        });
      }),
    };

    vi.mocked(PDFDocument).mockImplementationOnce(
      function DocumentoSimulado() {
        return documentoPDF as any;
      } as any
    );

    await expect(
      generarPDFConfirmacion(datosFicticios())
    ).rejects.toThrow('Error al generar constancia PDF');

    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });
});
