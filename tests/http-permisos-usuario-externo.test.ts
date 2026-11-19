
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/misEmpresasExternas.service', async importOriginal => {
  const original = await importOriginal<
    typeof import('../src/services/misEmpresasExternas.service')
  >();

  return {
    ...original,
    obtenerMisEmpresasExternas: vi.fn().mockResolvedValue({
      empresas: [
        { empresaId: 2, nombre: 'Contratista Demo PRISMA', perfil: 'administrador_externo' },
      ],
    }),
  };
});

import app from '../src/app';

function tokenExterno() {
  return jwt.sign(
    { id: 34, rol_id: 4 },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' }
  );
}

describe('HTTP - Permisos del cuarto rol', () => {
  it('permite al rol externo consultar el portal', async () => {
    const respuesta = await request(app)
      .get('/api/empresas-externas/mis-empresas')
      .set('Authorization', 'Bearer ' + tokenExterno());

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.empresas).toEqual([
      { empresaId: 2, nombre: 'Contratista Demo PRISMA', perfil: 'administrador_externo' },
    ]);
  });

  it.each([
    '/api/comentarios',
    '/api/preguntas-examen/1',
    '/api/respuestas-examen/examen/1',
  ])('exige sesión interna en %s', async ruta => {
    const sinSesion = await request(app).get(ruta);
    expect(sinSesion.status).toBe(401);

    const externo = await request(app)
      .get(ruta)
      .set('Authorization', 'Bearer ' + tokenExterno());

    expect(externo.status).toBe(403);
    expect(externo.body.mensaje).toBe(
      'Esta operación no está disponible para usuarios externos.'
    );
  });
});
