# Respaldos y restauración

Procedimientos mínimos para no perder datos de negocio ni artefactos de
modelos. Ajuste los nombres de proyecto/región a su entorno.

## Qué respaldar

| Dato | Ubicación | Frecuencia sugerida |
|---|---|---|
| Base de datos | PostgreSQL (Supabase o `postgres` de Compose) | diaria |
| Modelos y artefactos | bucket S3/Supabase Storage o volumen `models` | tras cada modelo aprobado |
| CSV originales | bucket o volumen `uploads` | diaria |
| Configuración y secretos | gestor de secretos del proveedor | al cambiar |

## Base de datos (Supabase)

Use la cadena de conexión del *Session pooler* y `pg_dump` (versión 16 o
superior). No versiones el archivo resultante.

```powershell
$env:PGPASSWORD = "<password>"
pg_dump `
  --host aws-0-<region>.pooler.supabase.com `
  --port 5432 `
  --username "postgres.<ref>" `
  --dbname postgres `
  --format custom `
  --no-owner `
  --file "neurolab_$(Get-Date -Format yyyyMMdd_HHmm).dump"
```

Programe el comando con el Programador de tareas (Windows) o `cron` y copie el
archivo a un almacenamiento externo con retención (por ejemplo, 30 días).

### Restauración

```powershell
$env:PGPASSWORD = "<password>"
pg_restore `
  --host aws-0-<region>.pooler.supabase.com `
  --port 5432 `
  --username "postgres.<ref>" `
  --dbname postgres `
  --clean --if-exists --no-owner `
  "neurolab_20261107_1200.dump"
```

Verifique después:

```powershell
python -m alembic current   # desde services/api
```

## Modelos y CSV (S3 / Supabase Storage)

Con AWS CLI configurado con las credenciales del proyecto:

```powershell
aws s3 sync s3://<bucket>/models ./backup/models --delete
aws s3 sync s3://<bucket>/uploads ./backup/uploads
```

Para restaurar, invierta el orden de origen y destino.

### Volúmenes locales (Docker Compose)

```powershell
docker run --rm `
  -v neurolab_enterprise_models:/data `
  -v ${PWD}/backup:/backup `
  alpine tar czf /backup/models.tgz -C /data .
```

Compruebe el nombre real del volumen con `docker volume ls`.

## Verificación

1. Restaure en una base de datos vacía y arranque la API.
2. `GET /health` debe responder `status: healthy` y `database: up`.
3. Abra un modelo aprobado y confirme que los SHA-256 del manifiesto
   coinciden con los artefactos descargados.
4. Ejecute una inferencia de prueba con un CSV conocido.
