import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Evitamos inicializar los modelos reales durante esta prueba HTTP.
vi.mock('../src/models', () => ({
  RelDocumentoUsuario: {},
  Usuario: {},
  Documento: {},
  FirmaDigital: {},
}));

import app from '../src/app';

describe('Seguridad - acceso público a constancias documentales', () => {
  it('bloquea el acceso directo a una constancia sin autenticación', async () => {
    const respuesta = await request(app)
      .get('/uploads/confirmaciones/constancia-ficticia.pdf');

    expect(respuesta.status).toBe(403);
  });

  it('bloquea el acceso directo incluso con un token enviado', async () => {
    const respuesta = await request(app)
      .get('/uploads/confirmaciones/constancia-ficticia.pdf')
      .set('Authorization', 'Bearer token-ficticio');

    expect(respuesta.status).toBe(403);
  });
});
