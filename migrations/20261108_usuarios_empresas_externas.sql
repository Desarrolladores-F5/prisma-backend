-- PRISMA - Empresas Externas
-- Etapa 2: Pertenencia de usuarios a empresas externas.
--
-- Esta migración agrega una tabla independiente.
-- No modifica las tablas usuarios, empresas ni roles.
--
-- Aplicar únicamente mediante un procedimiento controlado.
-- Probar primero en prisma_test_empresas_externas.

CREATE TABLE usuarios_empresas_externas (
    id INT NOT NULL AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    empresa_id INT NOT NULL,

    perfil VARCHAR(30) NOT NULL DEFAULT 'trabajador',

    activo TINYINT(1) NOT NULL DEFAULT 1,

    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uq_usuario_empresa_externa (
        usuario_id,
        empresa_id
    ),

    INDEX idx_usuario_empresa_externa_empresa (
        empresa_id
    ),

    CONSTRAINT fk_usuario_empresa_externa_usuario
        FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id),

    CONSTRAINT fk_usuario_empresa_externa_empresa
        FOREIGN KEY (empresa_id)
        REFERENCES empresas(id),

    CONSTRAINT chk_usuario_empresa_externa_perfil
        CHECK (
            perfil IN (
                'administrador_externo',
                'trabajador'
            )
        )

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
