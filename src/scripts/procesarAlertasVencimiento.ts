import { Notificacion } from '../models';
import sequelize from '../config/database';
import { Op, QueryTypes } from 'sequelize';

type TipoRegistro = 'epp' | 'medida';

interface Registro {
  id: number;
  descripcion: string;
  estado: string;
  fecha_limite: Date | string;
  usuario_id: number | null;
  usuario_activo: number | null;
  faena_id: number | null;
  faena_usuario_id: number | null;
  empresa_id: number | null;
  faena_activa: number | null;
}

interface Destinatario {
  id: number;
  rol_id: number;
  faena_id: number | null;
}

const ZONA_HORARIA = 'America/Santiago';

const fechaChile = (fecha: Date): string => {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(fecha);

  const obtener = (tipo: string): string =>
    partes.find(parte => parte.type === tipo)?.value ?? '';

  return `${obtener('year')}-${obtener('month')}-${obtener('day')}`;
};

const fechaCalendario = (valor: Date | string): string | null => {
  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  // Las fechas de vencimiento almacenadas se interpretan
  // usando su fecha calendario UTC original.
  return fecha.toISOString().substring(0, 10);
};

const diasHasta = (fecha: string): number => {
  const hoyChile = fechaChile(new Date());

  return Math.round(
    (Date.parse(`${fecha}T00:00:00Z`) -
      Date.parse(`${hoyChile}T00:00:00Z`)) / 86400000
  );
};

const obtenerHito = (
  tipo: TipoRegistro,
  estado: string,
  dias: number
): string | null => {
  const normalizado = estado.trim().toLowerCase();

  if (
    tipo === 'medida' &&
    !['pendiente', 'en curso'].includes(normalizado)
  ) return null;

  if (
    tipo === 'epp' &&
    !['nuevo', 'vigente', 'entregado'].includes(normalizado)
  ) return null;

  if (dias < 0) return 'vencido';
  if (dias === 0) return 'vence_hoy';

  const hitos = tipo === 'epp' ? [30, 15, 7] : [7];
  return hitos.includes(dias) ? `faltan_${dias}` : null;
};

async function main(): Promise<void> {
  try {
    const epp = await sequelize.query<Registro>(
      `SELECT e.id, e.tipo AS descripcion, e.estado,
              e.fecha_vencimiento AS fecha_limite,
              e.usuario_id, u.activo AS usuario_activo,
              COALESCE(e.faena_id, u.faena_id) AS faena_id,
              u.faena_id AS faena_usuario_id,
              f.empresa_id, f.activo AS faena_activa
       FROM epp e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
       LEFT JOIN faenas f
         ON f.id = COALESCE(e.faena_id, u.faena_id)
       WHERE e.activo = 1`,
      { type: QueryTypes.SELECT }
    );

    const medidas = await sequelize.query<Registro>(
      `SELECT m.id, m.descripcion, m.estado,
              m.fecha_cumplimiento AS fecha_limite,
              m.responsable_id AS usuario_id,
              u.activo AS usuario_activo,
              m.faena_id, u.faena_id AS faena_usuario_id,
              f.empresa_id, f.activo AS faena_activa
       FROM medidas_correctivas m
       LEFT JOIN usuarios u ON u.id = m.responsable_id
       LEFT JOIN faenas f ON f.id = m.faena_id`,
      { type: QueryTypes.SELECT }
    );

    const usuarios = await sequelize.query<Destinatario>(
      `SELECT id, rol_id, faena_id
       FROM usuarios WHERE activo = 1`,
      { type: QueryTypes.SELECT }
    );

    const faenas = await sequelize.query<{
      id: number;
      empresa_id: number;
      responsable_id: number;
    }>(
      `SELECT id, empresa_id, responsable_id
       FROM faenas WHERE activo = 1`,
      { type: QueryTypes.SELECT }
    );

    const filas: Record<string, unknown>[] = [];

    const pendientes: Array<{
      destinatarios: number[];
      claveEvento: string;
      mensaje: string;
      tipo: string;
      origen: string;
      faenaId: number;
    }> = [];

    for (const [tipo, registros] of [
      ['epp', epp],
      ['medida', medidas],
    ] as const) {
      for (const registro of registros) {
        const fecha = fechaCalendario(registro.fecha_limite);
        if (!fecha) continue;

        const dias = diasHasta(fecha);
        const hito = obtenerHito(tipo, registro.estado, dias);
        if (!hito) continue;

        const faenaId = Number(registro.faena_id);
        const empresaId = Number(registro.empresa_id);

        if (
          !Number.isSafeInteger(faenaId) || faenaId <= 0 ||
          !Number.isSafeInteger(empresaId) || empresaId <= 0 ||
          Number(registro.faena_activa) !== 1
        ) {
          filas.push({
            modulo: tipo,
            registro: registro.id,
            diagnostico: 'REVISAR: faena o empresa inválida',
          });
          continue;
        }

        const destinatarios = new Set<number>();

        // Avisos individuales: solo usuarios activos.
        const individual = usuarios.find(
          u => u.id === Number(registro.usuario_id)
        );

        if (
          individual &&
          Number(registro.usuario_activo) === 1 &&
          Number(individual.faena_id) === faenaId
        ) {
          destinatarios.add(individual.id);
        }

        // Administradores de la empresa de origen.
        const faenasEmpresa = new Set(
          faenas.filter(f => f.empresa_id === empresaId)
            .map(f => f.id)
        );

        for (const u of usuarios) {
          if (u.rol_id === 1 &&
              u.faena_id != null &&
              faenasEmpresa.has(u.faena_id)) {
            destinatarios.add(u.id);
          }
        }

        // Supervisor activo responsable de esa faena.
        const faena = faenas.find(f => f.id === faenaId);
        const supervisor = usuarios.find(
          u => u.id === faena?.responsable_id && u.rol_id === 2
        );
        if (supervisor) destinatarios.add(supervisor.id);

        const claveEvento = `${tipo}:${registro.id}:${fecha}:${hito}`;

        const mensaje = tipo === 'epp'
          ? `Alerta de EPP: ${registro.descripcion}. ` +
            (dias < 0
              ? 'El elemento está vencido.'
              : dias === 0
                ? 'El elemento vence hoy.'
                : `Faltan ${dias} días para su vencimiento.`)
          : `Alerta de medida correctiva: ${registro.descripcion}. ` +
            (dias < 0
              ? 'La medida está fuera de plazo.'
              : dias === 0
                ? 'El plazo vence hoy.'
                : `Faltan ${dias} días para su cumplimiento.`);

        pendientes.push({
          destinatarios: [...destinatarios],
          claveEvento,
          mensaje,
          tipo: tipo === 'epp'
            ? 'alerta_vencimiento_epp'
            : 'alerta_vencimiento_medida',
          origen: tipo === 'epp' ? 'epp' : 'medidas_correctivas',
          faenaId,
        });

        filas.push({
          modulo: tipo,
          registro: registro.id,
          estado: registro.estado,
          dias_restantes: dias,
          hito,
          faena_id: faenaId,
          empresa_id: empresaId,
          destinatarios: [...destinatarios].sort((a, b) => a - b).join(', ') || 'Ninguno',
          clave_evento: claveEvento,
        });
      }
    }

    console.table(filas);

    const argumentos = process.argv.slice(2);
    const enviar = argumentos.includes('--enviar');
    const confirmar = argumentos.includes('--confirmar');

    if (argumentos.some(arg =>
      !['--enviar', '--confirmar'].includes(arg)
    )) {
      throw new Error('Argumento no reconocido.');
    }

    if (enviar !== confirmar) {
      throw new Error(
        'Para registrar alertas se requieren --enviar --confirmar.'
      );
    }

    if (!enviar) {
      console.log(
        '\\nSIMULACIÓN: no se generaron notificaciones.'
      );
      return;
    }


    // Conciliar únicamente alertas automáticas de vencimiento.
    // Esta sección solo se ejecuta con --enviar --confirmar.
    const vigentes = new Set(
      pendientes.flatMap(a =>
        a.destinatarios.map(id =>
          `${a.tipo}|${id}|${a.claveEvento}|${a.faenaId}`
        )
      )
    );

    const anteriores = await Notificacion.findAll({
      where: {
        activo: true,
        tipo: { [Op.in]: [
          'alerta_vencimiento_epp',
          'alerta_vencimiento_medida',
        ] },
      },
    });

    let desactivadas = 0;
    for (const aviso of anteriores) {
      const origenEsperado = aviso.tipo === 'alerta_vencimiento_epp'
        ? 'epp' : 'medidas_correctivas';

      if (aviso.origen !== origenEsperado) continue;

      const clave = `${aviso.tipo}|${aviso.usuario_id}|${aviso.clave_evento}|${aviso.faena_id}`;

      if (!vigentes.has(clave)) {
        await aviso.update({ activo: false });
        desactivadas++;
      }
    }

    console.log(`Alertas obsoletas desactivadas: ${desactivadas}.`);

    let creadas = 0;
    let existentes = 0;
    let reactivadas = 0;

    for (const alerta of pendientes) {
      for (const usuarioId of alerta.destinatarios) {
        const [notificacion, creada] = await Notificacion.findOrCreate({
          where: {
            usuario_id: usuarioId,
            clave_evento: alerta.claveEvento,
          },
          defaults: {
            usuario_id: usuarioId,
            clave_evento: alerta.claveEvento,
            mensaje: alerta.mensaje,
            tipo: alerta.tipo,
            origen: alerta.origen,
            faena_id: alerta.faenaId,
            leido: false,
            activo: true,
          },
        });

        if (creada) {
          creadas++;
        } else {
          if (
            notificacion.tipo !== alerta.tipo ||
            notificacion.origen !== alerta.origen ||
            Number(notificacion.faena_id) !== alerta.faenaId
          ) {
            throw new Error(
              'Conflicto de identidad de alerta existente.'
            );
          }

          if (!notificacion.activo) {
            await notificacion.update({ activo: true });
            reactivadas++;
          } else {
            existentes++;
          }
        }
      }
    }

    console.log(
      `Alertas registradas: ${creadas}. ` +
      `Ya existentes: ${existentes}. ` +
      `Reactivadas: ${reactivadas}.`
    );
    console.log(
      '\n✅ Registro de alertas finalizado.'
    );
  } finally {
    await sequelize.close();
  }
}

main().catch(error => {
  console.error('❌ Error al simular alertas:', error);
  process.exitCode = 1;
});
