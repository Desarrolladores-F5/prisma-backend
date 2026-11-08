-- PRISMA - Empresas Externas
-- Etapa 2: Contratos y trabajadores externos.
--
-- IMPORTANTE:
-- Revisar antes de ejecutar.
-- No ejecutar automáticamente en producción.
-- Requiere respaldo previo de la base de datos.
--
-- Esta migración:
-- 1. Agrega un índice compuesto en faenas.
-- 2. Crea contratos_externos.
-- 3. Crea contratos_externos_trabajadores.
--
-- No elimina registros existentes.
-- No modifica usuarios ni documentos.

-- =========================================================
-- 1. Integridad entre mandante y faena
-- =========================================================

ALTER TABLE faenas
    ADD UNIQUE KEY uq_faena_empresa_id (empresa_id, id);

-- =========================================================
-- 2. Contratos de empresas externas
-- =========================================================

CREATE TABLE contratos_externos (
    id INT NOT NULL AUTO_INCREMENT,

    mandante_empresa_id INT NOT NULL,
    contratista_empresa_id INT NOT NULL,
    faena_id INT UNSIGNED NOT NULL,

    contrato_principal_id INT NULL,

    nombre VARCHAR(255) NOT NULL,
    numero_contrato VARCHAR(100) NULL,

    fecha_inicio DATE NULL,
    fecha_termino DATE NULL,

    estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',

    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    INDEX idx_contrato_mandante (mandante_empresa_id),
    INDEX idx_contrato_contratista (contratista_empresa_id),
    INDEX idx_contrato_faena (faena_id),
    INDEX idx_contrato_principal (contrato_principal_id),

    CONSTRAINT fk_contrato_mandante
        FOREIGN KEY (mandante_empresa_id)
        REFERENCES empresas(id),

    CONSTRAINT fk_contrato_contratista
        FOREIGN KEY (contratista_empresa_id)
        REFERENCES empresas(id),

    CONSTRAINT fk_contrato_mandante_faena
        FOREIGN KEY (mandante_empresa_id, faena_id)
        REFERENCES faenas(empresa_id, id),

    CONSTRAINT fk_contrato_principal
        FOREIGN KEY (contrato_principal_id)
        REFERENCES contratos_externos(id),

    CONSTRAINT chk_contrato_empresas_distintas
        CHECK (mandante_empresa_id <> contratista_empresa_id),

    CONSTRAINT chk_contrato_fechas
        CHECK (
            fecha_inicio IS NULL
            OR fecha_termino IS NULL
            OR fecha_termino >= fecha_inicio
        )

    -- La autorreferencia y los ciclos se validarán en el backend.

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 3. Trabajadores vinculados a contratos
-- =========================================================

CREATE TABLE contratos_externos_trabajadores (
    id INT NOT NULL AUTO_INCREMENT,

    contrato_id INT NOT NULL,
    usuario_id INT NOT NULL,

    fecha_incorporacion DATE NULL,
    fecha_desvinculacion DATE NULL,

    activo TINYINT(1) NOT NULL DEFAULT 1,

    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uq_contrato_trabajador (contrato_id, usuario_id),
    INDEX idx_contrato_trabajador_usuario (usuario_id),

    CONSTRAINT fk_contrato_trabajador_contrato
        FOREIGN KEY (contrato_id)
        REFERENCES contratos_externos(id),

    CONSTRAINT fk_contrato_trabajador_usuario
        FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id),

    CONSTRAINT chk_trabajador_fechas
        CHECK (
            fecha_incorporacion IS NULL
            OR fecha_desvinculacion IS NULL
            OR fecha_desvinculacion >= fecha_incorporacion
        )

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
