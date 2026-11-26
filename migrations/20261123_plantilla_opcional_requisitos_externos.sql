-- PRISMA: archivo opcional de la mandante en solicitudes documentales.
-- Aplicar primero en prisma_test_empresas_externas.
-- No modifica solicitudes ni acreditaciones existentes.

ALTER TABLE requisitos_documentales_externos
    ADD COLUMN plantilla_archivo_url VARCHAR(255) NULL,
    ADD COLUMN plantilla_nombre_original VARCHAR(255) NULL;
