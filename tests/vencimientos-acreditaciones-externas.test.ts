import { describe, expect, it } from 'vitest';

import {
  obtenerFechaActualChile,
  clasificarVigenciaAcreditacionExterna,
} from '../src/services/vencimientosAcreditacionesExternas.service';

describe('Vencimientos de acreditaciones documentales externas', () => {
  const referencia = new Date('2026-11-10T15:00:00.000Z');

  const clasificar = (
    estado: 'aprobado' | 'pendiente' | 'en_revision' | 'rechazado' | 'vencido',
    fechaVencimiento: string | null,
    diasAviso = 30
  ) =>
    clasificarVigenciaAcreditacionExterna(
      { estado, fechaVencimiento },
      { instante: referencia, diasAviso }
    );

  it('obtiene la fecha actual de Chile', () => {
    expect(obtenerFechaActualChile(referencia))
      .toBe('2026-11-10');
  });

  it('respeta la medianoche de Chile y no la de UTC', () => {
    expect(
      obtenerFechaActualChile(
        new Date('2026-11-11T01:30:00.000Z')
      )
    ).toBe('2026-11-10');

    expect(
      obtenerFechaActualChile(
        new Date('2026-11-11T03:30:00.000Z')
      )
    ).toBe('2026-11-11');
  });

  it('reconoce un documento vencido ayer', () => {
    const resultado = clasificar('aprobado', '2026-11-09');

    expect(resultado.clasificacion).toBe('vencido');
    expect(resultado.diasRestantes).toBe(-1);
  });

  it('mantiene vigente durante hoy un documento que vence hoy', () => {
    const resultado = clasificar('aprobado', '2026-11-10');

    expect(resultado.clasificacion).toBe('proximo_a_vencer');
    expect(resultado.diasRestantes).toBe(0);
  });

  it('detecta un documento que vence mañana', () => {
    const resultado = clasificar('aprobado', '2026-11-11');

    expect(resultado.clasificacion).toBe('proximo_a_vencer');
    expect(resultado.diasRestantes).toBe(1);
  });

  it('incluye exactamente los 30 días de aviso', () => {
    const resultado = clasificar('aprobado', '2026-12-10');

    expect(resultado.clasificacion).toBe('proximo_a_vencer');
    expect(resultado.diasRestantes).toBe(30);
  });

  it('considera vigente un documento que vence en 31 días', () => {
    const resultado = clasificar('aprobado', '2026-12-11');

    expect(resultado.clasificacion).toBe('vigente');
    expect(resultado.diasRestantes).toBe(31);
  });

  it('permite configurar los días de anticipación', () => {
    expect(
      clasificar('aprobado', '2026-11-20', 7).clasificacion
    ).toBe('vigente');

    expect(
      clasificar('aprobado', '2026-11-20', 10).clasificacion
    ).toBe('proximo_a_vencer');
  });

  it('no procesa automáticamente una acreditación pendiente', () => {
    expect(
      clasificar('pendiente', '2026-11-09').clasificacion
    ).toBe('no_aplica');
  });

  it('no procesa automáticamente una acreditación en revisión', () => {
    expect(
      clasificar('en_revision', '2026-11-09').clasificacion
    ).toBe('no_aplica');
  });

  it('no modifica la clasificación de una acreditación rechazada', () => {
    expect(
      clasificar('rechazado', '2026-11-09').clasificacion
    ).toBe('no_aplica');
  });

  it('reconoce una acreditación previamente vencida', () => {
    expect(
      clasificar('vencido', '2026-11-09').clasificacion
    ).toBe('vencido');
  });

  it('no procesa acreditaciones sin fecha de vencimiento', () => {
    expect(
      clasificar('aprobado', null).clasificacion
    ).toBe('no_aplica');
  });

  it('rechaza fechas inexistentes', () => {
    expect(() =>
      clasificar('aprobado', '2026-02-30')
    ).toThrow('Fecha de vencimiento inválida.');
  });

  it('rechaza plazos de aviso fuera del rango permitido', () => {
    expect(() =>
      clasificar('aprobado', '2026-11-20', -1)
    ).toThrow();

    expect(() =>
      clasificar('aprobado', '2026-11-20', 366)
    ).toThrow();
  });

  it('rechaza instantes de referencia inválidos', () => {
    expect(() =>
      obtenerFechaActualChile(new Date('fecha-invalida'))
    ).toThrow('Instante de referencia inválido.');
  });

  it('respeta los años bisiestos', () => {
    const resultado = clasificarVigenciaAcreditacionExterna(
      {
        estado: 'aprobado',
        fechaVencimiento: '2028-03-01',
      },
      {
        instante: new Date('2028-02-28T15:00:00.000Z'),
      }
    );

    expect(resultado.diasRestantes).toBe(2);
    expect(resultado.clasificacion).toBe('proximo_a_vencer');
  });
});
