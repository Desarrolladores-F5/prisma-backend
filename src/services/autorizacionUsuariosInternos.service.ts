import { Usuario, Faena } from '../models';

export class ErrorAutorizacionUsuarioInterno extends Error {
  constructor(
    public readonly estadoHttp: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorAutorizacionUsuarioInterno';
  }
}

const idValido = (valor: unknown): valor is number =>
  typeof valor === 'number' &&
  Number.isSafeInteger(valor) &&
  valor > 0;

/**
 * Identifica la empresa real de un administrador o supervisor
 * interno, utilizando exclusivamente relaciones de MySQL.
 *
 * No acepta empresa_id enviado por el frontend.
 * No utiliza el rol declarado en el JWT como autorización final.
 */
export const obtenerEmpresaUsuarioInterno = async (
  usuarioId: number
): Promise<number> => {
  if (!idValido(usuarioId)) {
    throw new ErrorAutorizacionUsuarioInterno(
      401,
      'Identidad de usuario inválida.'
    );
  }

  const usuario = await Usuario.findByPk(usuarioId, {
    attributes: ['id', 'rol_id', 'activo', 'faena_id'],
  });

  if (
    !usuario ||
    usuario.activo !== true ||
    ![1, 2].includes(usuario.rol_id) ||
    !idValido(usuario.faena_id)
  ) {
    throw new ErrorAutorizacionUsuarioInterno(
      403,
      'Usuario sin autorización interna vigente.'
    );
  }

  const faena = await Faena.findByPk(usuario.faena_id, {
    attributes: ['id', 'empresa_id'],
  });

  const empresaId = Number(faena?.get('empresa_id'));

  if (!idValido(empresaId)) {
    throw new ErrorAutorizacionUsuarioInterno(
      403,
      'No fue posible identificar la empresa del usuario.'
    );
  }

  return empresaId;
};

/**
 * Identifica la empresa de un administrador con permisos
 * vigentes para gestionar usuarios.
 *
 * Comprueba el rol actual en MySQL, no el rol del JWT.
 * No concede permisos de escritura a supervisores.
 */
export const obtenerEmpresaAdministradorUsuarios = async (
  administradorId: number
): Promise<number> => {
  if (!idValido(administradorId)) {
    throw new ErrorAutorizacionUsuarioInterno(
      401,
      'Identidad de administrador inválida.'
    );
  }

  const administrador = await Usuario.findByPk(administradorId, {
    attributes: ['id', 'rol_id', 'activo', 'faena_id'],
  });

  if (
    !administrador ||
    administrador.activo !== true ||
    administrador.rol_id !== 1 ||
    !idValido(administrador.faena_id)
  ) {
    throw new ErrorAutorizacionUsuarioInterno(
      403,
      'Usuario sin permisos administrativos vigentes.'
    );
  }

  const faena = await Faena.findByPk(administrador.faena_id, {
    attributes: ['id', 'empresa_id'],
  });

  const empresaId = Number(faena?.get('empresa_id'));

  if (!idValido(empresaId)) {
    throw new ErrorAutorizacionUsuarioInterno(
      403,
      'No fue posible identificar la empresa del administrador.'
    );
  }

  return empresaId;
};
