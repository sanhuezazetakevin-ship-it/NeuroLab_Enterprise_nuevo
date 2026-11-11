# Ejecuta UNA vez el worker real de entrenamiento contra la base de la demo.
# Sirve para procesar el trabajo en cola durante la exposicion.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts/run_worker_once.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/run_worker_once.ps1 -JobId <uuid>
param(
    [string]$DemoDir = (Join-Path $env:TEMP "neurolab_demo"),
    [string]$JobId = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$DemoDir = [System.IO.Path]::GetFullPath($DemoDir)

$env:NEUROLAB_DEMO_DIR = $DemoDir
$env:ENVIRONMENT = "development"
$env:DATABASE_URL = "sqlite+aiosqlite:///$($DemoDir -replace '\\', '/')/demo.db"
$env:DATA_DIR = (Join-Path $DemoDir "uploads")
$env:MODEL_DIR = (Join-Path $DemoDir "models")
$env:TEMP_DIR = (Join-Path $DemoDir "tmp")
$env:QUEUE_BACKEND = "filesystem"
$env:STORAGE_BACKEND = "local"
$env:SECRET_KEY = "demo_secret_key_neurolab_1234567890abcdef"
$env:WORKER_ID = "demo-worker-1"
$env:WORKER_HEARTBEAT_TIMEOUT_SECONDS = "900"
$env:QUEUE_POLL_SECONDS = "0.5"
$env:TF_CPP_MIN_LOG_LEVEL = "2"
$env:PYTHONUNBUFFERED = "1"
$env:S3_ENDPOINT_URL = ""
$env:S3_ACCESS_KEY_ID = ""
$env:S3_SECRET_ACCESS_KEY = ""

$workerArgs = @("workers\training\worker.py", "--once")
if ($JobId) { $workerArgs += @("--job-id", $JobId) }

Push-Location $repo
try {
    & python @workerArgs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
