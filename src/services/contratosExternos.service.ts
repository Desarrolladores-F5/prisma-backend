// src/services/contratosExternos.service.ts

import { Transaction } from 'sequelize';
import { ContratoExterno, Empresa, Faena } from '../models';
import { obtenerEmpresaAdministrador } from './asignacionDocumental.service';

export class ErrorContratoExterno extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorContratoExterno';
  }
}

export interface SolicitudCrearContratoExterno {
  administradorId: number;
  contratistaEmpresaId: number;
  faenaId: number;
  nombre: string;
  numeroContrato?: string | null;
  contratoPrincipalId?: number | null;
  fechaInicio?: string | null;
  fechaTermino?: string | null;
  transaction?: Transaction;
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

const fechaValida = (valor: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false;
  }

  const fecha = new Date(`${valor}T00:00:00.000Z`);

  return (
    !Number.isNaN(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === valor
  );
};

const normalizarFecha = (
  valor: string | null | undefined,
  campo: string
): string | null => {
  if (valor === null || valor === undefined) {
    return null;
  }

  if (typeof valor !== 'string' || !fechaValida(valor)) {
    throw new ErrorContratoExterno(
      400,
      `${campo} debe tener formato YYYY-MM-DD y ser una fecha válida.`
    );
  }

  return valor;
};

export const crearContratoExterno = async ({
  administradorId,
  contratistaEmpresaId,
  faenaId,
  nombre,
  numeroContrato,
  contratoPrincipalId,
  fechaInicio,
  fechaTermino,
  transaction,
}: SolicitudCrearContratoExterno): Promise<ContratoExterno> => {
  if (
    !idValido(administradorId) ||
    !idValido(contratistaEmpresaId) ||
    !idValido(faenaId)
  ) {
    throw new ErrorContratoExterno(
      400,
      'Los identificadores del contrato son inválidos.'
    );
  }

  if (
    contratoPrincipalId !== undefined &&
    contratoPrincipalId !== null &&
    !idValido(contratoPrincipalId)
  ) {
    throw new ErrorContratoExterno(
      400,
      'El identificador del contrato principal es inválido.'
    );
  }

  if (
    typeof nombre !== 'string' ||
    !nombre.trim() ||
    nombre.trim().length > 255
  ) {
    throw new ErrorContratoExterno(
      400,
      'El nombre del contrato es obligatorio y no puede superar 255 caracteres.'
    );
  }

  if (
    numeroContrato !== undefined &&
    numeroContrato !== null &&
    (
      typeof numeroContrato !== 'string' ||
      !numeroContrato.trim() ||
      numeroContrato.trim().length > 100
    )
  ) {
    throw new ErrorContratoExterno(
      400,
      'El número de contrato es inválido.'
    );
  }

  const inicio = normalizarFecha(fechaInicio, 'La fecha de inicio');
  const termino = normalizarFecha(fechaTermino, 'La fecha de término');

  if (inicio && termino && termino < inicio) {
    throw new ErrorContratoExterno(
      400,
      'La fecha de término no puede ser anterior a la de inicio.'
    );
  }

  // La mandante se identifica mediante el administrador
  // registrado en la base de datos.
  // Nunca se acepta mandante_empresa_id desde el frontend.
  const mandanteEmpresaId = transaction
    ? await obtenerEmpresaAdministrador(
        administradorId,
        { transaction }
      )
    : await obtenerEmpresaAdministrador(
        administradorId
      );

  if (mandanteEmpresaId === contratistaEmpresaId) {
    throw new ErrorContratoExterno(
      400,
      'La mandante y la contratista deben ser empresas distintas.'
    );
  }

  // Las consultas directas del servicio utilizarán
  // la transacción recibida, cuando exista.
  const opcionesTransaccion = transaction
    ? { transaction }
    : {};

  const mandante = await Empresa.findByPk(
    mandanteEmpresaId,
    {
      attributes: ['id', 'activo'],
      ...opcionesTransaccion,
    }
  );

  if (!mandante || mandante.get('activo') !== true) {
    throw new ErrorContratoExterno(
      403,
      'La empresa mandante no está habilitada.'
    );
  }

  const contratista = await Empresa.findByPk(
    contratistaEmpresaId,
    {
      attributes: ['id', 'activo'],
      ...opcionesTransaccion,
    }
  );

  if (!contratista || contratista.get('activo') !== true) {
    throw new ErrorContratoExterno(
      400,
      'La empresa contratista no existe o no está activa.'
    );
  }

  const faena = await Faena.findByPk(
    faenaId,
    {
      attributes: ['id', 'empresa_id', 'activo'],
      ...opcionesTransaccion,
    }
  );

  if (
    !faena ||
    faena.get('activo') !== true ||
    Number(faena.get('empresa_id')) !== mandanteEmpresaId
  ) {
    throw new ErrorContratoExterno(
      403,
      'La faena no pertenece a la mandante o no está activa.'
    );
  }

  if (
    contratoPrincipalId !== undefined &&
    contratoPrincipalId !== null
  ) {
    const principal = await ContratoExterno.findByPk(
      contratoPrincipalId,
      opcionesTransaccion
    );

    if (
      !principal ||
      principal.mandante_empresa_id !== mandanteEmpresaId ||
      principal.faena_id !== faenaId
    ) {
      throw new ErrorContratoExterno(
        400,
        'El contrato principal no corresponde a la mandante y faena indicadas.'
      );
    }

    if (
      principal.contratista_empresa_id === contratistaEmpresaId
    ) {
      throw new ErrorContratoExterno(
        400,
        'La subcontratista debe ser distinta de la contratista principal.'
      );
    }
  }

  const datosContrato = {
    mandante_empresa_id: mandanteEmpresaId,
    contratista_empresa_id: contratistaEmpresaId,
    faena_id: faenaId,
    contrato_principal_id: contratoPrincipalId ?? null,
    nombre: nombre.trim(),
    numero_contrato: numeroContrato?.trim() ?? null,
    fecha_inicio: inicio,
    fecha_termino: termino,
    estado: 'pendiente',
  };

  // Conservamos la llamada original cuando no hay transacción.
  // Esto permite mantener compatibilidad con los consumidores
  // y las pruebas existentes.
  if (!transaction) {
    return ContratoExterno.create(datosContrato);
  }

  // Cuando existe una transacción, INSERT queda dentro de ella.
  // El consumidor decide si ejecuta COMMIT o ROLLBACK.
  return ContratoExterno.create(
    datosContrato,
    { transaction }
  );
};
