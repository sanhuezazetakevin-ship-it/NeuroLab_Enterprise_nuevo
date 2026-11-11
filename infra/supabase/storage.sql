-- ==========================================
-- NEUROLAB ENTERPRISE - SUPABASE STORAGE
-- ==========================================
-- Ejecutar una vez en el SQL Editor del proyecto Supabase.
-- El bucket es privado: la API y el worker acceden con las claves S3 del
-- proyecto, no con la clave anónima. No se requieren políticas RLS públicas.

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'neurolab',
    'neurolab',
    false,
    52428800,
    array['text/csv', 'application/octet-stream', 'application/json']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
