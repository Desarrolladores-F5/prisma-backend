import { Formulario } from '../models';
import { Capacitacion, Examen } from '../models';
//src/services/notificacionesAutomaticas.service.ts
import { Documento, Faena, MedidaCorrectiva, Notificacion, Usuario } from '../models';

type RolNotificable = 1 | 2;

interface CrearNotificacionesAutomaticas {
  mensaje: string;
  tipo: string;
  origen: string;
  claveEvento: string;
  destinatariosIds?: number[];
  roles?: RolNotificable[];
  faenaId?: number;
  agregarUsuarioIdClave?: boolean;
}

/**
 * Servicio central de notificaciones automáticas de PRISMA.
 *
 * Administrador (1): recibe avisos de toda la instalación.
 * Supervisor (2): recibe avisos de sus faenas asignadas.
 * Trabajador (3): recibe avisos mediante destinatariosIds.
 */
export const crearNotificacionesAutomaticas = async ({
  mensaje,
  tipo,
  origen,
  claveEvento,
  destinatariosIds = [],
  roles = [],
  faenaId,
  agregarUsuarioIdClave = false,
}: CrearNotificacionesAutomaticas): Promise<number> => {
  const idValido = (id: unknown): id is number =>
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0;

  if (
    !mensaje.trim() ||
    !tipo.trim() ||
    !origen.trim() ||
    !claveEvento.trim()
  ) {
    throw new Error('Los datos de la notificación son obligatorios.');
  }

  if (
    !Array.isArray(destinatariosIds) ||
    !destinatariosIds.every(idValido) ||
    !Array.isArray(roles) ||
    roles.some((rol) => rol !== 1 && rol !== 2) ||
    (faenaId !== undefined && !idValido(faenaId))
  ) {
    throw new Error('Datos de destinatarios inválidos.');
  }

  // Validar destinatarios explícitos antes de cualquier escritura.
  if (faenaId !== undefined) {
    for (const id of new Set(destinatariosIds)) {
      const usuario = await Usuario.findByPk(id, {
        attributes: ['id', 'activo', 'faena_id'],
      });
      if (!usuario || usuario.activo !== true ||
          Number(usuario.faena_id) !== faenaId) {
        throw new Error(
          'Destinatario inactivo o fuera de la faena autorizada.'
        );
      }
    }
  }

  const destinatarios = new Set<number>(destinatariosIds);

  // Administradores: únicamente los de la empresa de la faena.
  // Sin faena no se realiza difusión general entre empresas.
  if (roles.includes(1) && faenaId !== undefined) {
    const faenaOrigen = await Faena.findByPk(faenaId, {
      attributes: ['id', 'empresa_id'],
    });

    const empresaId = Number(faenaOrigen?.get('empresa_id'));

    if (!idValido(empresaId)) {
      throw new Error(
        'No se puede identificar la empresa de la notificación.'
      );
    }

    const administradores = await Usuario.findAll({
      attributes: ['id'],
      where: {
        rol_id: 1,
        activo: true,
      },
      include: [{
        model: Faena,
        as: 'faena',
        attributes: [],
        required: true,
        where: {
          empresa_id: empresaId,
        },
      }],
    });

    administradores.forEach((usuario) => {
      destinatarios.add(Number(usuario.id));
    });
  }

  // Supervisor: recibe eventos de las faenas que tiene a cargo.
  if (roles.includes(2) && faenaId !== undefined) {
    const faena = await Faena.findByPk(faenaId, {
      attributes: ['id', 'responsable_id'],
    });

    const responsableId = Number(faena?.get('responsable_id'));

    if (idValido(responsableId)) {
      const supervisores = await Usuario.findAll({
        attributes: ['id'],
        where: {
          id: responsableId,
          rol_id: 2,
          activo: true,
        },
      });

      supervisores.forEach((usuario) => {
        destinatarios.add(Number(usuario.id));
      });
    }
  }

  let creadas = 0;

  for (const usuarioId of destinatarios) {
    const clave = agregarUsuarioIdClave
      ? `${claveEvento}:${usuarioId}`
      : claveEvento;

    const defaults: Record<string, unknown> = {
      usuario_id: usuarioId,
      clave_evento: clave,
      mensaje,
      tipo,
      origen,
      leido: false,
      activo: true,
    };

    if (faenaId !== undefined) {
      defaults.faena_id = faenaId;
    }

    const [, creada] = await Notificacion.findOrCreate({
      where: {
        usuario_id: usuarioId,
        clave_evento: clave,
      },
      defaults: defaults as any,
    });

    if (creada) creadas++;
  }

  return creadas;
};

/**
 * Notificar al administrador cuando un trabajador
 * confirma la recepción de un documento.
 */
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

  if (!trabajador) {
    return 0;
  }

  const nombreTrabajador = [
    trabajador.nombre,
    trabajador.apellido,
  ].filter(Boolean).join(' ');

  return crearNotificacionesAutomaticas({
    mensaje:
      `${nombreTrabajador} confirmó la recepción del documento ` +
      `«${nombreDocumento}».`,
    tipo: 'recepcion_documental',
    origen: 'documentos',
    claveEvento: `recepcion_documental:${documentoId}:${usuarioId}`,
    roles: [1],
    faenaId: trabajador.faena_id
      ? Number(trabajador.faena_id)
      : undefined,
  });
};

/**
 * Notificar a los trabajadores cuando reciben
 * una nueva asignación documental.
 */
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
  if (
    !Number.isSafeInteger(documentoId) ||
    documentoId <= 0 ||
    !Array.isArray(destinatariosIds) ||
    !destinatariosIds.every(
      (id) => Number.isSafeInteger(id) && id > 0
    )
  ) {
    throw new Error('Datos de asignación inválidos.');
  }

  // Identificar la empresa propietaria del documento desde MySQL.
  const documento = await Documento.findByPk(documentoId, {
    attributes: ['id', 'empresa_id'],
  });

  const empresaId = Number(documento?.get('empresa_id'));

  if (!Number.isSafeInteger(empresaId) || empresaId <= 0) {
    throw new Error(
      'No se pudo validar la empresa propietaria del documento.'
    );
  }

  // Comprobar todos los destinatarios antes de generar avisos.
  const idsUnicos = [...new Set(destinatariosIds)];

  if (idsUnicos.length > 0) {
    const usuariosAutorizados = await Usuario.findAll({
      attributes: ['id'],
      where: {
        id: idsUnicos,
        activo: true,
      },
      include: [{
        model: Faena,
        as: 'faena',
        attributes: [],
        required: true,
        where: {
          empresa_id: empresaId,
          activo: true,
        },
      }],
    });

    const autorizados = new Set(
      usuariosAutorizados.map(usuario => Number(usuario.id))
    );

    if (idsUnicos.some(id => !autorizados.has(id))) {
      throw new Error(
        'Uno o más destinatarios están inactivos o fuera de la empresa.'
      );
    }
  }

  return crearNotificacionesAutomaticas({
    mensaje:
      `Tienes un nuevo documento asignado: «${nombreDocumento}».`,
    tipo: 'asignacion_documental',
    origen: 'documentos',
    claveEvento: `asignacion_documental:${documentoId}`,
    destinatariosIds,
    agregarUsuarioIdClave: true,
  });
};

interface AvisoMedidaCorrectiva {
  medidaId: number;
  descripcion: string;
  responsableId: number;
}

export const avisarMedidaCorrectiva = async ({
  medidaId,
  descripcion,
  responsableId,
}: AvisoMedidaCorrectiva): Promise<number> => {
  if (
    !Number.isSafeInteger(medidaId) || medidaId <= 0 ||
    !Number.isSafeInteger(responsableId) || responsableId <= 0 ||
    typeof descripcion !== 'string' ||
    !descripcion.trim()
  ) {
    throw new Error('Datos de medida correctiva inválidos.');
  }

  const medida = await MedidaCorrectiva.findByPk(medidaId, {
    attributes: ['id', 'faena_id', 'responsable_id'],
  });
  const faenaOrigenId = Number(medida?.faena_id);
  if (!medida || !Number.isSafeInteger(faenaOrigenId) ||
      faenaOrigenId <= 0 || Number(medida.responsable_id) !== responsableId) {
    throw new Error('Medida sin faena de origen verificada o responsable incorrecto.');
  }

  const responsable = await Usuario.findByPk(responsableId, {
    attributes: [
      'id',
      'nombre',
      'apellido',
      'faena_id',
      'activo',
    ],
  });

  const faenaId = faenaOrigenId;

  if (
    !responsable ||
    responsable.activo !== true ||
    Number(responsable.faena_id) !== faenaId ||
    !Number.isSafeInteger(faenaId) ||
    faenaId <= 0
  ) {
    throw new Error(
      'El responsable debe estar activo y tener una faena válida.'
    );
  }

  const faena = await Faena.findByPk(faenaId, {
    attributes: ['id', 'empresa_id', 'activo'],
  });

  const empresaId = Number(faena?.get('empresa_id'));

  if (
    !faena ||
    faena.get('activo') !== true ||
    !Number.isSafeInteger(empresaId) ||
    empresaId <= 0
  ) {
    throw new Error(
      'No se encontró una faena activa para la medida.'
    );
  }

  const nombreResponsable = [
    responsable.nombre,
    responsable.apellido,
  ].filter(Boolean).join(' ');

  return crearNotificacionesAutomaticas({
    mensaje:
      `Nueva medida correctiva registrada: «${descripcion.trim()}». ` +
      `Responsable: ${nombreResponsable}.`,
    tipo: 'medida_correctiva',
    origen: 'medidas_correctivas',
    claveEvento: `medida_correctiva:${medidaId}`,
    destinatariosIds: [responsableId],
    roles: [1, 2],
    faenaId,
    agregarUsuarioIdClave: true,
  });
};

interface AvisoInspeccion {
  inspeccionId: number;
  faenaId: number;
  inspectorId?: number | null;
  tipo: string;
  descripcion: string;
}

export const avisarInspeccion = async ({
  inspeccionId,
  faenaId,
  inspectorId,
  tipo,
  descripcion,
}: AvisoInspeccion): Promise<number> => {
  const idValido = (id: unknown): id is number =>
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0;

  if (
    !idValido(inspeccionId) ||
    !idValido(faenaId) ||
    (inspectorId != null && !idValido(inspectorId))
  ) {
    throw new Error('Identificadores de inspección inválidos.');
  }

  const faena = await Faena.findByPk(faenaId, {
    attributes: ['id', 'activo'],
  });

  if (!faena || faena.get('activo') !== true) {
    throw new Error('Faena de inspección no encontrada o inactiva.');
  }

  const destinatariosIds: number[] = [];

  if (inspectorId != null) {
    const inspector = await Usuario.findByPk(inspectorId, {
      attributes: ['id', 'activo', 'faena_id'],
    });

    if (
      !inspector ||
      inspector.activo !== true ||
      Number(inspector.faena_id) !== faenaId
    ) {
      throw new Error('Inspector no pertenece a la faena o está inactivo.');
    }

    destinatariosIds.push(inspectorId);
  }

  return crearNotificacionesAutomaticas({
    mensaje: `Nueva inspección registrada: ${tipo}. ${descripcion}`,
    tipo: 'inspeccion',
    origen: 'inspecciones',
    claveEvento: `inspeccion:${inspeccionId}`,
    faenaId,
    roles: [1, 2],
    destinatariosIds,
  });
};

interface AvisoAuditoria {
  auditoriaId: number;
  faenaId: number;
  auditorId: number;
  tipo?: string | null;
  descripcion?: string | null;
}

export const avisarAuditoria = async ({
  auditoriaId,
  faenaId,
  auditorId,
  tipo,
  descripcion,
}: AvisoAuditoria): Promise<number> => {
  const idValido = (id: number): boolean =>
    Number.isSafeInteger(id) && id > 0;

  if (
    !idValido(auditoriaId) ||
    !idValido(faenaId) ||
    !idValido(auditorId)
  ) {
    throw new Error('Identificadores de auditoría inválidos.');
  }

  const faena = await Faena.findByPk(faenaId, {
    attributes: ['id', 'activo'],
  });

  if (!faena || faena.get('activo') !== true) {
    throw new Error('Faena de auditoría no encontrada o inactiva.');
  }

  const auditor = await Usuario.findByPk(auditorId, {
    attributes: ['id', 'activo', 'faena_id'],
  });

  if (
    !auditor ||
    auditor.activo !== true ||
    Number(auditor.faena_id) !== faenaId
  ) {
    throw new Error('Auditor no pertenece a la faena o está inactivo.');
  }

  const detalle = [tipo, descripcion]
    .filter((valor): valor is string =>
      typeof valor === 'string' && valor.trim().length > 0
    )
    .join('. ');

  return crearNotificacionesAutomaticas({
    mensaje: detalle
      ? `Nueva auditoría registrada: ${detalle}`
      : 'Nueva auditoría registrada.',
    tipo: 'auditoria',
    origen: 'auditorias',
    claveEvento: `auditoria:${auditoriaId}`,
    faenaId,
    roles: [1, 2],
    destinatariosIds: [auditorId],
  });
};

interface AvisoCapacitacion {
  capacitacionId: number;
  titulo: string;
  faenaId: number;
  capacitadorId: number;
}

export const avisarCapacitacion = async ({
  capacitacionId,
  titulo,
  faenaId,
  capacitadorId,
}: AvisoCapacitacion): Promise<number> => {
  const idValido = (id: number): boolean =>
    Number.isSafeInteger(id) && id > 0;

  if (
    !idValido(capacitacionId) ||
    !idValido(faenaId) ||
    !idValido(capacitadorId) ||
    !titulo.trim()
  ) {
    throw new Error('Datos de capacitación inválidos.');
  }

  const faena = await Faena.findByPk(faenaId, {
    attributes: ['id', 'activo'],
  });

  if (!faena || faena.get('activo') !== true) {
    throw new Error('Faena no encontrada o inactiva.');
  }

  const capacitador = await Usuario.findByPk(capacitadorId, {
    attributes: ['id', 'activo', 'faena_id'],
  });

  if (
    !capacitador ||
    capacitador.activo !== true ||
    Number(capacitador.faena_id) !== faenaId
  ) {
    throw new Error(
      'Capacitador inactivo o no asociado a la faena.'
    );
  }

  return crearNotificacionesAutomaticas({
    mensaje: `Nueva capacitación programada: ${titulo}.`,
    tipo: 'capacitacion',
    origen: 'capacitaciones',
    claveEvento: `capacitacion:${capacitacionId}`,
    faenaId,
    roles: [1, 2],
    destinatariosIds: [capacitadorId],
    agregarUsuarioIdClave: true,
  });
};

interface AvisoResultadoExamen {
  examenId: number;
  trabajadorId: number;
  porcentaje: number;
  aprobado: boolean;
}

export const avisarResultadoExamen = async ({
  examenId,
  trabajadorId,
  porcentaje,
  aprobado,
}: AvisoResultadoExamen): Promise<number> => {
  const idValido = (id: number): boolean =>
    Number.isSafeInteger(id) && id > 0;

  if (
    !idValido(examenId) ||
    !idValido(trabajadorId) ||
    !Number.isFinite(porcentaje) ||
    porcentaje < 0 ||
    porcentaje > 100 ||
    typeof aprobado !== 'boolean'
  ) {
    throw new Error('Datos de resultado de examen inválidos.');
  }

  const examen = await Examen.findByPk(examenId, {
    attributes: ['id', 'titulo', 'capacitacion_id', 'activo'],
  });

  if (!examen || examen.activo !== true) {
    throw new Error('Examen no encontrado o inactivo.');
  }

  const capacitacion = await Capacitacion.findByPk(
    examen.capacitacion_id,
    {
      attributes: ['id', 'titulo', 'faena_id', 'activo'],
    }
  );

  if (!capacitacion || capacitacion.activo !== true) {
    throw new Error('Capacitación no encontrada o inactiva.');
  }

  const faenaId = Number(capacitacion.faena_id);

  const trabajador = await Usuario.findByPk(trabajadorId, {
    attributes: ['id', 'activo', 'faena_id', 'nombre', 'apellido'],
  });

  if (
    !trabajador ||
    trabajador.activo !== true ||
    Number(trabajador.faena_id) !== faenaId
  ) {
    throw new Error('Trabajador inactivo o fuera de la faena.');
  }

  const faena = await Faena.findByPk(faenaId, {
    attributes: ['id', 'activo'],
  });

  if (!faena || faena.get('activo') !== true) {
    throw new Error('Faena no encontrada o inactiva.');
  }

  const resultado = aprobado ? 'Aprobado' : 'Reprobado';

  return crearNotificacionesAutomaticas({
    mensaje:
      `Resultado de examen "${examen.titulo}" ` +
      `de ${trabajador.nombre} ${trabajador.apellido}: ` +
      `${resultado} (${porcentaje}%).`,
    tipo: 'resultado_examen',
    origen: 'examenes',
    claveEvento: `resultado_examen:${examenId}:${trabajadorId}`,
    faenaId,
    destinatariosIds: [trabajadorId],
    roles: [1, 2],
  });
};

interface AvisoEntregaEPP {
  eppId: number;
  trabajadorId: number;
  faenaId?: number | null;
  tipo: string;
}

export const avisarEntregaEPP = async ({
  eppId,
  trabajadorId,
  faenaId,
  tipo,
}: AvisoEntregaEPP): Promise<number> => {
  const idValido = (id: unknown): id is number =>
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0;

  if (
    !idValido(eppId) ||
    !idValido(trabajadorId) ||
    (faenaId != null && !idValido(faenaId)) ||
    !tipo.trim()
  ) {
    throw new Error('Datos de entrega de EPP inválidos.');
  }

  const trabajador = await Usuario.findByPk(trabajadorId, {
    attributes: ['id', 'activo', 'faena_id', 'rol_id'],
  });

  if (
    !trabajador ||
    trabajador.activo !== true ||
    trabajador.rol_id !== 3
  ) {
    throw new Error('Trabajador no encontrado o inactivo.');
  }

  const faenaTrabajador = Number(trabajador.faena_id);

  if (!idValido(faenaTrabajador)) {
    throw new Error('El trabajador no tiene una faena válida.');
  }

  if (faenaId != null && faenaId !== faenaTrabajador) {
    throw new Error('La faena del EPP no coincide con la del trabajador.');
  }

  const faena = await Faena.findByPk(faenaTrabajador, {
    attributes: ['id', 'activo'],
  });

  if (!faena || faena.get('activo') !== true) {
    throw new Error('Faena no encontrada o inactiva.');
  }

  return crearNotificacionesAutomaticas({
    mensaje: `Nueva entrega de EPP registrada: ${tipo}.`,
    tipo: 'entrega_epp',
    origen: 'epp',
    claveEvento: `entrega_epp:${eppId}`,
    faenaId: faenaTrabajador,
    destinatariosIds: [trabajadorId],
    roles: [1, 2],
    agregarUsuarioIdClave: true,
  });
};

interface AvisoNuevoFormulario {
  formularioId: number;
  nombre: string;
  faenaId?: number | null;
}

export const avisarNuevoFormulario = async ({
  formularioId,
  nombre,
  faenaId,
}: AvisoNuevoFormulario): Promise<number> => {
  const idValido = (id: unknown): id is number =>
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0;

  if (
    !idValido(formularioId) ||
    typeof nombre !== 'string' ||
    !nombre.trim() ||
    (faenaId != null && !idValido(faenaId))
  ) {
    throw new Error('Datos de formulario inválidos.');
  }

  if (faenaId != null) {
    const faena = await Faena.findByPk(faenaId, {
      attributes: ['id', 'activo'],
    });

    if (!faena || faena.get('activo') !== true) {
      throw new Error('Faena del formulario no encontrada o inactiva.');
    }
  }

  return crearNotificacionesAutomaticas({
    mensaje: `Nuevo formulario disponible: ${nombre.trim()}.`,
    tipo: 'nuevo_formulario',
    origen: 'formularios',
    claveEvento: `formulario:${formularioId}`,
    ...(faenaId != null ? { faenaId } : {}),
    roles: faenaId != null ? [1, 2] : [1],
  });
};

interface AvisoRespuestaFormulario {
  respuestaId: number;
  formularioId: number;
  trabajadorId: number;
}

export const avisarRespuestaFormulario = async ({
  respuestaId,
  formularioId,
  trabajadorId,
}: AvisoRespuestaFormulario): Promise<number> => {
  const idValido = (id: number): boolean =>
    Number.isSafeInteger(id) && id > 0;

  if (
    !idValido(respuestaId) ||
    !idValido(formularioId) ||
    !idValido(trabajadorId)
  ) {
    throw new Error('Identificadores de respuesta inválidos.');
  }

  const formulario = await Formulario.findByPk(formularioId, {
    attributes: ['id', 'nombre', 'faena_id', 'activo'],
  });

  if (!formulario || formulario.activo !== true) {
    throw new Error('Formulario no encontrado o inactivo.');
  }

  const trabajador = await Usuario.findByPk(trabajadorId, {
    attributes: ['id', 'activo', 'rol_id', 'faena_id'],
  });

  if (
    !trabajador ||
    trabajador.activo !== true ||
    Number(trabajador.rol_id) !== 3
  ) {
    throw new Error('Trabajador no encontrado o inactivo.');
  }

  const faenaId = Number(formulario.faena_id);

  if (
    !idValido(faenaId) ||
    Number(trabajador.faena_id) !== faenaId
  ) {
    throw new Error(
      'El formulario no corresponde a la faena del trabajador.'
    );
  }

  const faena = await Faena.findByPk(faenaId, {
    attributes: ['id', 'activo'],
  });

  if (!faena || faena.get('activo') !== true) {
    throw new Error('Faena no encontrada o inactiva.');
  }

  return crearNotificacionesAutomaticas({
    mensaje:
      `Se registró una respuesta al formulario ` +
      `"${formulario.nombre}".`,
    tipo: 'respuesta_formulario',
    origen: 'formularios',
    claveEvento: `respuesta_formulario:${respuestaId}`,
    faenaId,
    roles: [1, 2],
  });
};
