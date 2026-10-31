import { Faena, Notificacion, Usuario } from '../models';

interface AvisoRecepcionDocumental {
  usuarioId: number;
  documentoId: number;
  nombreDocumento: string;
}

export const avisarRecepcionDocumental = async ({
  usuarioId,
  documentoId,
  nombreDocumento,
}: AvisoRecepcionDocumental): Promise<number> => {
  if (
    !Number.isSafeInteger(usuarioId) ||
    usuarioId <= 0 ||
    !Number.isSafeInteger(documentoId) ||
    documentoId <= 0
  ) {
    throw new Error('Identificadores de recepción inválidos.');
  }

  const trabajador = await Usuario.findByPk(usuarioId, {
    attributes: ['id', 'nombre', 'apellido', 'faena_id'],
  });

  if (!trabajador?.faena_id) {
    return 0;
  }

  const faena = await Faena.findByPk(trabajador.faena_id, {
    attributes: ['id', 'empresa_id'],
  });

  const empresaId = Number(faena?.get('empresa_id'));

  if (!Number.isSafeInteger(empresaId) || empresaId <= 0) {
    return 0;
  }

  const administradores = await Usuario.findAll({
    attributes: ['id'],
    where: {
      rol_id: 1,
      activo: true,
    },
    include: [
      {
        model: Faena,
        as: 'faena',
        attributes: [],
        required: true,
        where: {
          empresa_id: empresaId,
        },
      },
    ],
  });

  if (administradores.length === 0) {
    return 0;
  }

  const nombreTrabajador = [
    trabajador.nombre,
    trabajador.apellido,
  ].filter(Boolean).join(' ');

  const mensaje =
    `${nombreTrabajador} confirmó la recepción del documento ` +
    `«${nombreDocumento}».`;

  const claveEvento = `recepcion_documental:${documentoId}:${usuarioId}`;

  let creadas = 0;

  for (const administrador of administradores) {
    const [, creada] = await Notificacion.findOrCreate({
      where: {
        usuario_id: administrador.id,
        clave_evento: claveEvento,
      },
      defaults: {
        usuario_id: administrador.id,
        clave_evento: claveEvento,
        mensaje,
        tipo: 'recepcion_documental',
        origen: 'documentos',
        faena_id: trabajador.faena_id,
        leido: false,
        activo: true,
      },
    });

    if (creada) {
      creadas++;
    }
  }

  return creadas;
};


interface AvisoAsignacionDocumental {
  documentoId: number;
  nombreDocumento: string;
  destinatariosIds: number[];
}

export const avisarAsignacionDocumental = async ({
  documentoId,
  nombreDocumento,
  destinatariosIds,
}: AvisoAsignacionDocumental): Promise<number> => {
  const idValido = (id: unknown): id is number =>
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0;

  if (
    !idValido(documentoId) ||
    !Array.isArray(destinatariosIds) ||
    !destinatariosIds.every(idValido)
  ) {
    throw new Error('Datos de asignación inválidos.');
  }

  const destinatariosUnicos = [...new Set(destinatariosIds)];

  let creadas = 0;

  for (const usuarioId of destinatariosUnicos) {
    const [, creada] = await Notificacion.findOrCreate({
      where: {
        usuario_id: usuarioId,
        clave_evento: `asignacion_documental:${documentoId}:${usuarioId}`,
      },
      defaults: {
        usuario_id: usuarioId,
        clave_evento: `asignacion_documental:${documentoId}:${usuarioId}`,
        mensaje: `Tienes un nuevo documento asignado: «${nombreDocumento}».`,
        tipo: 'asignacion_documental',
        origen: 'documentos',
        leido: false,
        activo: true,
      },
    });

    if (creada) creadas++;
  }

  return creadas;
};
