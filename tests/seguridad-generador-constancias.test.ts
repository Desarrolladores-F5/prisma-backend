import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('pdfkit', () => ({
  default: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(),
    existsSync: vi.fn(),
    promises: { unlink: vi.fn().mockResolvedValue(undefined) },
  },
}));

import PDFDocument from 'pdfkit';
import fs from 'fs';
import { generarPDFConfirmacion } from '../src/utils/pdf';

describe('Seguridad del generador de constancias PDF', () => {
  it('permite simular PDFKit y el sistema de archivos sin generar PDF reales', () => {
    expect(vi.isMockFunction(PDFDocument)).toBe(true);
    expect(vi.isMockFunction(fs.createWriteStream)).toBe(true);
    expect(vi.isMockFunction(fs.mkdirSync)).toBe(true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('limpia el PDF parcial cuando falla la escritura', async () => {
    const stream = new EventEmitter();

    vi.mocked(fs.createWriteStream).mockReturnValueOnce(stream as any);

    const documentoPDF = {
      pipe: vi.fn(),
      once: vi.fn().mockReturnThis(),
      fontSize: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      moveDown: vi.fn().mockReturnThis(),
      end: vi.fn(() => {
        queueMicrotask(() => {
          stream.emit('error', new Error('Error simulado de escritura'));
        });
      }),
    };

    vi.mocked(PDFDocument).mockImplementationOnce(
      function DocumentoPDFSimulado() {
        return documentoPDF as any;
      } as any
    );

    await expect(
      generarPDFConfirmacion({
        documento: {
          nombre: 'Documento de prueba',
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
      })
    ).rejects.toThrow('Error al generar constancia PDF');

    expect(fs.promises.unlink).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /[/\\]uploads[/\\]confirmaciones[/\\]confirmacion_doc_45_usuario_12_.*\.pdf$/
      )
    );
  });

});
