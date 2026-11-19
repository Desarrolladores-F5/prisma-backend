-- PRISMA - Rol Usuario externo.
-- Aplicar mediante el procedimiento controlado de migraciones SQL.
-- No cambia los roles de usuarios existentes.
--
-- Si el nombre ya está asignado a otro ID, se intenta insertar con
-- ese ID ocupado para que la clave primaria rechace la operación.
-- Si el ID 4 está ocupado por otro rol, la clave primaria también
-- rechaza el INSERT. No se usa IGNORE ni se sobrescriben filas.

INSERT INTO roles (id, nombre, descripcion, activo, fecha_creacion)
SELECT
    COALESCE(conflicto.id, 4),
    'Usuario externo',
    'Acceso al Portal de Empresas Externas según su vinculación empresarial.',
    1,
    NOW()
FROM (SELECT 1) AS origen
LEFT JOIN (
    SELECT id
    FROM roles
    WHERE id <> 4
      AND LOWER(TRIM(nombre)) = 'usuario externo'
    ORDER BY id
    LIMIT 1
) AS conflicto ON 1 = 1
WHERE conflicto.id IS NOT NULL
   OR NOT EXISTS (
       SELECT 1
       FROM roles
       WHERE id = 4
         AND BINARY nombre = BINARY 'Usuario externo'
         AND activo = 1
   );
