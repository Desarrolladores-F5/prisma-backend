// src/models/index.ts
'use client';

import sequelize from '../config/database';

// 🔰 Importación e inicialización de modelos
import { initRol, Rol } from './rol.model';
import { initUsuario, Usuario } from './usuario.model';
import { initReporte, Reporte } from './reporte.model';
import { initFaena, Faena } from './faena.model';
import { initAuditoria, Auditoria } from './auditoria.model';
import { initEmpresa, Empresa } from './empresa.model';
import { initCapacitacion, Capacitacion } from './capacitacion.model';
import { initExamen, Examen } from './examen.model';
import { initPreguntaExamen, PreguntaExamen } from './pregunta_examen.model';
import { initRespuestaExamen, RespuestaExamen } from './respuesta_examen.model';
import { Documento } from './documento.model';
import { EPP } from './epp.model';
import { Notificacion } from './notificacion.model';
import { MedidaCorrectiva } from './medida_correctiva.model';
import { Inspeccion } from './inspeccion.model';
import { initFirmaDigital, FirmaDigital } from './firma_digital.model';
import { initFormulario, Formulario } from './formulario.model';
import { initRespuestaFormulario, RespuestaFormulario } from './respuesta_formulario.model';
import { initEstadistica, Estadistica } from './estadistica.model';
import { initComentario, Comentario } from './comentario.model';
import { initHistorialCambio, HistorialCambio } from './historial_cambio.model';
import { initRelDocumentoUsuario, RelDocumentoUsuario } from './rel_documentos_usuarios.model';
import { initContratoExterno, ContratoExterno } from './contrato_externo.model';
import {
  initContratoExternoTrabajador,
  ContratoExternoTrabajador,
} from './contrato_externo_trabajador.model';

// 🔹 Inicialización de modelos
initRol(sequelize);
initUsuario(sequelize);
initReporte(sequelize);
initFaena(sequelize);
initAuditoria(sequelize);
initEmpresa(sequelize);
initCapacitacion(sequelize);
initExamen(sequelize);
initPreguntaExamen(sequelize);
initRespuestaExamen(sequelize);
initFormulario(sequelize);
initFirmaDigital(sequelize);
initRespuestaFormulario(sequelize);
initEstadistica(sequelize);
initComentario(sequelize);
initHistorialCambio(sequelize);
initRelDocumentoUsuario(sequelize);
initContratoExterno(sequelize);
initContratoExternoTrabajador(sequelize);

// 🔹 Relaciones generales
Usuario.belongsTo(Rol, { foreignKey: 'rol_id', as: 'rol' });
Rol.hasMany(Usuario, { foreignKey: 'rol_id', as: 'usuarios' });

Usuario.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(Usuario, { foreignKey: 'faena_id', as: 'usuarios' });

Reporte.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(Reporte, { foreignKey: 'faena_id', as: 'reportes' });

Reporte.belongsTo(Auditoria, { foreignKey: 'auditoria_id', as: 'auditoria' });
Auditoria.hasMany(Reporte, { foreignKey: 'auditoria_id', as: 'reportes' });

Reporte.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Usuario.hasMany(Reporte, { foreignKey: 'usuario_id', as: 'reportes_creados' });

Faena.belongsTo(Empresa, { foreignKey: 'empresa_id', as: 'empresa' });
Empresa.hasMany(Faena, { foreignKey: 'empresa_id', as: 'faenas' });

Faena.belongsTo(Usuario, { foreignKey: 'responsable_id', as: 'responsable' });
Usuario.hasMany(Faena, { foreignKey: 'responsable_id', as: 'faenas_responsables' });

Capacitacion.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Usuario.hasMany(Capacitacion, { foreignKey: 'usuario_id', as: 'capacitaciones' });

Capacitacion.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(Capacitacion, { foreignKey: 'faena_id', as: 'capacitaciones' });

Capacitacion.belongsTo(Documento, { foreignKey: 'documento_id', as: 'documento' });
Documento.hasMany(Capacitacion, { foreignKey: 'documento_id', as: 'capacitaciones' });

Examen.belongsTo(Capacitacion, { foreignKey: 'capacitacion_id', as: 'capacitacion' });
Capacitacion.hasOne(Examen, { foreignKey: 'capacitacion_id', as: 'examen' });

PreguntaExamen.belongsTo(Examen, { foreignKey: 'examen_id', as: 'examen' });
Examen.hasMany(PreguntaExamen, {
  foreignKey: 'examen_id',
  as: 'preguntas',
  onDelete: 'CASCADE',
  hooks: true,
});

RespuestaExamen.belongsTo(Examen, { foreignKey: 'examen_id', as: 'examen' });
Examen.hasMany(RespuestaExamen, {
  foreignKey: 'examen_id',
  as: 'respuestas',
  onDelete: 'CASCADE',
  hooks: true,
});

RespuestaExamen.belongsTo(PreguntaExamen, { foreignKey: 'pregunta_id', as: 'pregunta' });
PreguntaExamen.hasMany(RespuestaExamen, { foreignKey: 'pregunta_id', as: 'respuestas' });

RespuestaExamen.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Usuario.hasMany(RespuestaExamen, { foreignKey: 'usuario_id', as: 'respuestas_examen' });

Formulario.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador' });
Usuario.hasMany(Formulario, { foreignKey: 'creador_id', as: 'formularios_creados' });

RespuestaFormulario.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Usuario.hasMany(RespuestaFormulario, { foreignKey: 'usuario_id', as: 'respuestas_formulario' });

RespuestaFormulario.belongsTo(Formulario, { foreignKey: 'formulario_id', as: 'formulario' });
Formulario.hasMany(RespuestaFormulario, { foreignKey: 'formulario_id', as: 'respuestas' });

Estadistica.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(Estadistica, { foreignKey: 'faena_id', as: 'estadisticas' });

Estadistica.belongsTo(Usuario, { foreignKey: 'generado_por', as: 'usuario' });
Usuario.hasMany(Estadistica, { foreignKey: 'generado_por', as: 'estadisticas_generadas' });

MedidaCorrectiva.belongsTo(Faena, {
  foreignKey: 'faena_id',
  as: 'faena',
});

Faena.hasMany(MedidaCorrectiva, {
  foreignKey: 'faena_id',
  as: 'medidas_correctivas',
});

MedidaCorrectiva.belongsTo(Usuario, { foreignKey: 'responsable_id', as: 'responsable' });
Usuario.hasMany(MedidaCorrectiva, { foreignKey: 'responsable_id', as: 'medidas_correctivas' });

MedidaCorrectiva.belongsTo(Documento, { foreignKey: 'evidencia_documento_id', as: 'evidencia' });
Documento.hasMany(MedidaCorrectiva, { foreignKey: 'evidencia_documento_id', as: 'medidas_con_evidencia' });

Notificacion.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Usuario.hasMany(Notificacion, { foreignKey: 'usuario_id', as: 'notificaciones' });

Notificacion.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(Notificacion, { foreignKey: 'faena_id', as: 'notificaciones' });

Inspeccion.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(Inspeccion, { foreignKey: 'faena_id', as: 'inspecciones' });

Inspeccion.belongsTo(Usuario, { foreignKey: 'inspector_id', as: 'inspector' });
Usuario.hasMany(Inspeccion, { foreignKey: 'inspector_id', as: 'inspecciones_realizadas' });

// 🔗 Asociación entre Comentario y Usuario
Comentario.belongsTo(Usuario, { foreignKey: 'autor_id', as: 'autor' });
Usuario.hasMany(Comentario, { foreignKey: 'autor_id', as: 'comentarios' });

// 🔗 Asociación entre HistorialCambio y Usuario
HistorialCambio.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Usuario.hasMany(HistorialCambio, { foreignKey: 'usuario_id', as: 'historial_cambios' });

// 🔁 Corrección aquí — relación entre FirmaDigital, Usuario y Documento
FirmaDigital.belongsTo(Usuario, { foreignKey: 'firmante_id', as: 'firmante' });
Usuario.hasMany(FirmaDigital, { foreignKey: 'firmante_id', as: 'firmas_digitales' });

FirmaDigital.belongsTo(Documento, { foreignKey: 'documento_id', as: 'documento' });
Documento.hasMany(FirmaDigital, { foreignKey: 'documento_id', as: 'firmas_digitales' });

EPP.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Usuario.hasMany(EPP, { foreignKey: 'usuario_id', as: 'epp_asignado' });

EPP.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(EPP, { foreignKey: 'faena_id', as: 'epp_faena' });

Formulario.belongsTo(Faena, { foreignKey: 'faena_id', as: 'faena' });
Faena.hasMany(Formulario, { foreignKey: 'faena_id', as: 'formularios' });

// Relación muchos a muchos: Documento ←→ Usuario
Documento.belongsToMany(Usuario, {
  through: RelDocumentoUsuario,
  foreignKey: 'documento_id',
  otherKey: 'usuario_id',
  as: 'usuarios_asignados',
});

Usuario.belongsToMany(Documento, {
  through: RelDocumentoUsuario,
  foreignKey: 'usuario_id',
  otherKey: 'documento_id',
  as: 'documentos_asignados',
});

// Relaciones explícitas tabla intermedia
RelDocumentoUsuario.belongsTo(Documento, { foreignKey: 'documento_id', as: 'documento' });
RelDocumentoUsuario.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });

Documento.hasMany(RelDocumentoUsuario, { foreignKey: 'documento_id', as: 'asignaciones' });
Usuario.hasMany(RelDocumentoUsuario, { foreignKey: 'usuario_id', as: 'asignaciones' });

// Contratos de empresas externas
ContratoExterno.belongsTo(Empresa, {
  foreignKey: 'mandante_empresa_id',
  as: 'mandante',
});
Empresa.hasMany(ContratoExterno, {
  foreignKey: 'mandante_empresa_id',
  as: 'contratos_como_mandante',
});

ContratoExterno.belongsTo(Empresa, {
  foreignKey: 'contratista_empresa_id',
  as: 'contratista',
});
Empresa.hasMany(ContratoExterno, {
  foreignKey: 'contratista_empresa_id',
  as: 'contratos_como_contratista',
});

ContratoExterno.belongsTo(Faena, {
  foreignKey: 'faena_id',
  as: 'faena',
});
Faena.hasMany(ContratoExterno, {
  foreignKey: 'faena_id',
  as: 'contratos_externos',
});

ContratoExterno.belongsTo(ContratoExterno, {
  foreignKey: 'contrato_principal_id',
  as: 'contrato_principal',
});
ContratoExterno.hasMany(ContratoExterno, {
  foreignKey: 'contrato_principal_id',
  as: 'subcontratos',
});

ContratoExternoTrabajador.belongsTo(ContratoExterno, {
  foreignKey: 'contrato_id',
  as: 'contrato',
});
ContratoExterno.hasMany(ContratoExternoTrabajador, {
  foreignKey: 'contrato_id',
  as: 'trabajadores_vinculados',
});

ContratoExternoTrabajador.belongsTo(Usuario, {
  foreignKey: 'usuario_id',
  as: 'usuario',
});
Usuario.hasMany(ContratoExternoTrabajador, {
  foreignKey: 'usuario_id',
  as: 'contratos_externos',
});

// ✅ Exportación de modelos
export {
  sequelize,
  Rol,
  Usuario,
  Reporte,
  Faena,
  Auditoria,
  Empresa,
  Capacitacion,
  Examen,
  PreguntaExamen,
  RespuestaExamen,
  Documento,
  EPP,
  Notificacion,
  MedidaCorrectiva,
  Inspeccion,
  FirmaDigital,
  Formulario,
  RespuestaFormulario,
  Estadistica,
  Comentario,
  HistorialCambio,
  RelDocumentoUsuario,
  ContratoExterno,
  ContratoExternoTrabajador,
};
