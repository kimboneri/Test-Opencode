-- Esquema de base de datos para el sistema de registro y monitoreo
-- Ejecutar este SQL en el Editor SQL de Supabase

CREATE TABLE mensajes_wsp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remitente TEXT NOT NULL,
    contenido TEXT,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Opcional: Habilitar Realtime para la tabla (necesario para el dashboard en vivo)
-- Ve a Database > Replication en Supabase y habilita la replicación para la tabla mensajes_wsp
-- o ejecuta:
-- ALTER PUBLICATION supabase_realtime ADD TABLE mensajes_wsp;
