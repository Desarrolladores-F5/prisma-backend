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
import { obtenerEmpresaAdministrador } from '../src/services/asignacionDocumental.service';
import requisitosRoutes from '../src/routes/requisitosDocumentalesExternos.routes';

const app = express();
app.use(express.json());
app.use('/api/contratos-externos', requisitosRoutes);

const query = vi.mocked(sequelize.query);
const resolverMandante = vi.mocked(obtenerEmpresaAdministrador);

const solicitar = (contratoId: number) => {
  const token = jwt.sign({ id: 11, rol_id: 1 }, process.env.JWT_SECRET!);

  return request(app)
    .post('/api/contratos-externos/' + contratoId + '/requisitos')
    .set('Authorization', 'Bearer ' + token)
    .send({ nombre: '  Certificado de capacitación  ' });
};

const verificarConsulta = (contratoId: number) => {
  expect(resolverMandante).toHaveBeenCalledWith(11);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining(
      'WHERE c.id = :contratoId AND c.mandante_empresa_id = :mandanteId'
    ),
    {
      replacements: {
        contratoId,
        mandanteId: 1,
        nombre: 'Certificado de capacitación',
      },
      type: QueryTypes.INSERT,
    }
  );
};

describe('HTTP - Solicitudes documentales externas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolverMandante.mockResolvedValue(1);
  });

  it('crea una solicitud sin archivo en el contrato de la mandante', async () => {
    query.mockImplementationOnce(async () => [71, 1]);

    const respuesta = await solicitar(10);

    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toEqual({
      id: 71,
      contratoId: 10,
      nombre: 'Certificado de capacitación',
    });
    verificarConsulta(10);
  });

  it('no crea una solicitud cuando el contrato no pertenece a la mandante', async () => {
    query.mockImplementationOnce(async () => [0, 0]);

    const respuesta = await solicitar(20);

    expect(respuesta.status).toBe(404);
    expect(respuesta.body).toEqual({
      mensaje: 'Contrato no disponible para esta mandante.',
    });
    verificarConsulta(20);
  });
});


const consultarSolicitudes = (usuarioId: number) => {
  const token = jwt.sign({ id: usuarioId, rol_id: 3 }, process.env.JWT_SECRET!);

  return request(app)
    .get('/api/contratos-externos/mis-requisitos')
    .set('Authorization', 'Bearer ' + token);
};

describe('HTTP - Mis solicitudes documentales externas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('devuelve una solicitud pendiente de carga aunque no tenga PDF', async () => {
    const solicitud = {
      id: 71,
      contratoId: 10,
      nombre: 'Certificado de capacitación',
      empresaId: 2,
      mandante: 'Empresa F5',
      acreditacionId: null,
      estado: 'pendiente_carga',
      observaciones: null,
      fechaPresentacion: null,
      fechaRevision: null,
    };
    query.mockImplementationOnce(async () => [solicitud]);

    const respuesta = await consultarSolicitudes(34);

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers['cache-control']).toBe('no-store');
    expect(respuesta.body).toEqual({ solicitudes: [solicitud] });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN acreditaciones_documentales_externas'),
      { replacements: { usuarioId: 34 }, type: QueryTypes.SELECT }
    );
  });

  it('devuelve una lista vacía si no hay una vinculación autorizada', async () => {
    query.mockImplementationOnce(async () => []);

    const respuesta = await consultarSolicitudes(35);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ solicitudes: [] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE u.id = :usuarioId AND u.activo = 1'),
      { replacements: { usuarioId: 35 }, type: QueryTypes.SELECT }
    );
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('v.empresa_id');
    expect(sql).toContain("v.activo = 1 AND v.perfil = 'administrador_externo'");
    expect(sql).toContain('c.contratista_empresa_id = e.id');
  });
});
