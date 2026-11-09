-- PRISMA - Empresas Externas
-- Etapa 2: Requisitos y acreditaciones documentales.
--
-- IMPORTANTE:
-- No ejecutar automaticamente en produccion.
-- Requiere revision, respaldo y pruebas previas.
-- Primera ejecucion: prisma_test_empresas_externas.
--
-- Esta migracion:
-- 1. Agrega un indice unico a trabajadores por contrato.
-- 2. Crea requisitos_documentales_externos.
-- 3. Crea acreditaciones_documentales_externas.
-- 4. Protege la correspondencia entre trabajador y contrato.
--
-- No modifica documentos, usuarios ni empresas.
-- No elimina registros existentes.
--
-- PENDIENTE ANTES DE HABILITAR ENDPOINTS:
-- Validar autorizacion del presentador y revisor.
-- Validar propiedad empresarial del documento.
-- Validar destinatario empresa/trabajador.
-- Validar estados y transiciones de revision.
-- Conservar historial de presentaciones.

-- =========================================================
-- 1. Integridad del trabajador dentro de su contrato
-- =========================================================

ALTER TABLE contratos_externos_trabajadores
    ADD UNIQUE KEY uq_trabajador_vinculado_contrato
        (id, contrato_id);

-- =========================================================
-- 2. Requisitos documentales externos
-- =========================================================

CREATE TABLE requisitos_documentales_externos (
    id INT NOT NULL AUTO_INCREMENT,

    contrato_id INT NOT NULL,

    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT NULL,

    destinatario VARCHAR(20) NOT NULL,

    obligatorio TINYINT(1) NOT NULL DEFAULT 1,

    periodicidad VARCHAR(30) NOT NULL DEFAULT 'unica',

    activo TINYINT(1) NOT NULL DEFAULT 1,

    fecha_creacion DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uq_requisito_contrato
        (id, contrato_id),

    INDEX idx_requisitos_contrato
        (contrato_id),

    CONSTRAINT fk_requisito_contrato_externo
        FOREIGN KEY (contrato_id)
        REFERENCES contratos_externos(id),

    CONSTRAINT chk_requisito_destinatario
        CHECK (
            destinatario IN ('empresa', 'trabajador')
        ),

    CONSTRAINT chk_requisito_periodicidad
        CHECK (
            periodicidad IN (
                'unica',
                'mensual',
                'trimestral',
                'semestral',
                'anual',
                'por_vencimiento'
            )
        ),

    CONSTRAINT chk_requisito_obligatorio
        CHECK (obligatorio IN (0, 1)),

    CONSTRAINT chk_requisito_activo
        CHECK (activo IN (0, 1))

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 3. Acreditaciones documentales externas
-- =========================================================

CREATE TABLE acreditaciones_documentales_externas (
    id INT NOT NULL AUTO_INCREMENT,

    contrato_id INT NOT NULL,

    requisito_id INT NOT NULL,

    documento_id INT NOT NULL,

    contrato_trabajador_id INT NULL,

    fecha_emision DATE NULL,
    fecha_vencimiento DATE NULL,

    periodo_inicio DATE NULL,
    periodo_termino DATE NULL,

    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',

    observaciones TEXT NULL,

    presentado_por INT NOT NULL,
    revisado_por INT NULL,

    fecha_presentacion DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    fecha_revision DATETIME NULL,

    PRIMARY KEY (id),

    INDEX idx_acreditacion_contrato
        (contrato_id),

    INDEX idx_acreditacion_requisito_contrato
        (requisito_id, contrato_id),

    INDEX idx_acreditacion_documento
        (documento_id),

    INDEX idx_acreditacion_trabajador_contrato
        (contrato_trabajador_id, contrato_id),

    INDEX idx_acreditacion_estado
        (estado),

    INDEX idx_acreditacion_presentado
        (presentado_por),

    INDEX idx_acreditacion_revisado
        (revisado_por),

    -- El requisito debe pertenecer al mismo contrato.

    CONSTRAINT fk_acreditacion_requisito_contrato
        FOREIGN KEY (requisito_id, contrato_id)
        REFERENCES requisitos_documentales_externos
            (id, contrato_id),

    -- Reutiliza el documento existente.

    CONSTRAINT fk_acreditacion_documento
        FOREIGN KEY (documento_id)
        REFERENCES documentos(id),

    -- El trabajador debe estar vinculado
    -- exactamente al contrato de la acreditacion.

    CONSTRAINT fk_acreditacion_trabajador_contrato
        FOREIGN KEY (
            contrato_trabajador_id,
            contrato_id
        )
        REFERENCES contratos_externos_trabajadores
            (id, contrato_id),

    CONSTRAINT fk_acreditacion_presentador
        FOREIGN KEY (presentado_por)
        REFERENCES usuarios(id),

    CONSTRAINT fk_acreditacion_revisor
        FOREIGN KEY (revisado_por)
        REFERENCES usuarios(id),

    CONSTRAINT chk_acreditacion_estado
        CHECK (
            estado IN (
                'pendiente',
                'en_revision',
                'aprobado',
                'rechazado',
                'vencido'
            )
        ),

    CONSTRAINT chk_acreditacion_fechas_emision
        CHECK (
            fecha_emision IS NULL
            OR fecha_vencimiento IS NULL
            OR fecha_vencimiento >= fecha_emision
        ),

    CONSTRAINT chk_acreditacion_periodo
        CHECK (
            periodo_inicio IS NULL
            OR periodo_termino IS NULL
            OR periodo_termino >= periodo_inicio
        )

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
