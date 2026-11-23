import express from 'express';
import jwt from 'jsonwebtoken';
import { QueryTypes } from 'sequelize';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/models', () => ({
  sequelize: { query: vi.fn() },
}));

vi.mock('../src/services/asignacionDocumental.service', () => ({
  obtenerEmpresaAdministrador: vi.fn(),
  ErrorAsignacionDocumental: class extends Error {},
}));

import { sequelize } from '../src/models';
import requisitosRoutes from '../src/routes/requisitosDocumentalesExternos.routes';
import { obtenerEmpresaAdministrador } from '../src/services/asignacionDocumental.service';

const app = express();
app.use('/api/contratos-externos', requisitosRoutes);

const ruta = '/api/contratos-externos/entregas-por-resolver';
const query = vi.mocked(sequelize.query);
const resolverMandante = vi.mocked(obtenerEmpresaAdministrador);

const consultar = (rolId = 1) => {
  const token = jwt.sign({ id: 11, rol_id: rolId }, process.env.JWT_SECRET!);

  return request(app)
    .get(ruta)
    .set('Authorization', 'Bearer ' + token);
};

describe('HTTP - Entregas externas por resolver', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolverMandante.mockResolvedValue(27);
  });

  it('devuelve un total numérico limitado a la mandante de la sesión', async () => {
    query.mockImplementationOnce(async () => [{ total: '3' }]);

    const respuesta = await consultar();

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers['cache-control']).toBe('no-store');
    expect(respuesta.body).toEqual({ total: 3 });
    expect(resolverMandante).toHaveBeenCalledWith(11);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE c.mandante_empresa_id = :mandanteId'),
      { replacements: { mandanteId: 27 }, type: QueryTypes.SELECT }
    );
  });

  it('selecciona la última entrega de empresa antes de filtrar los estados', async () => {
    query.mockImplementationOnce(async () => [{ total: 0 }]);

    const respuesta = await consultar();

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ total: 0 });

    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toContain('SELECT COUNT(*) AS total');
    expect(sql).toContain(
      'JOIN acreditaciones_documentales_externas a ON a.id = ('
    );
    expect(sql).toContain(
      'WHERE ultima.contrato_id = c.id AND ultima.requisito_id = r.id ' +
      'AND ultima.contrato_trabajador_id IS NULL ' +
      'ORDER BY ultima.fecha_presentacion DESC, ultima.id DESC LIMIT 1 )'
    );
    expect(sql).toContain(
      "WHERE c.mandante_empresa_id = :mandanteId " +
      "AND r.activo = 1 AND r.destinatario = 'empresa' " +
      "AND a.estado IN ('pendiente', 'en_revision')"
    );
  });

  it('rechaza una consulta sin sesión', async () => {
    const respuesta = await request(app).get(ruta);

    expect(respuesta.status).toBe(401);
    expect(resolverMandante).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([3, 4])('rechaza el rol %i sin consultar la base', async rolId => {
    const respuesta = await consultar(rolId);

    expect(respuesta.status).toBe(403);
    expect(resolverMandante).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('rechaza una mandante enviada como parámetro', async () => {
    const respuesta = await consultar().query({ mandanteId: 99 });

    expect(respuesta.status).toBe(400);
    expect(resolverMandante).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
