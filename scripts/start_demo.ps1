# ==========================================================
# NEUROLAB ENTERPRISE - DEMO LOCAL PARA EXPOSICION
# ==========================================================
# Levanta la API y la web con una base SQLite temporal aislada, siembra datos
# reales (proyecto, dataset, entrenamiento y modelo aprobado) y deja el sistema
# listo para presentar. No toca la base de datos configurada en .env.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts/start_demo.ps1 -Fresh
#
# Opciones:
#   -Fresh            Detiene la demo previa, borra y recrea la carpeta
#   -NoWorker         No arranca el worker persistente; deja el job en cola
#                     para ejecutarlo manualmente con run_worker_once.ps1
#   -DemoDir <ruta>   Carpeta de trabajo (por defecto %TEMP%\neurolab_demo)
#   -ApiPort <n>      Puerto de la API (8000)
#   -WebPort <n>      Puerto del frontend (5173)

param(
    [switch]$Fresh,
    [switch]$NoWorker,
    [string]$DemoDir = (Join-Path $env:TEMP "neurolab_demo"),
    [int]$ApiPort = 8000,
    [int]$WebPort = 5173
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$DemoDir = [System.IO.Path]::GetFullPath($DemoDir)
$apiBase = "http://127.0.0.1:$ApiPort"

function Stop-ProcessTree {
    param([int]$TargetId)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $TargetId } |
        ForEach-Object { Stop-ProcessTree -TargetId ([int]$_.ProcessId) }
    Stop-Process -Id $TargetId -Force -ErrorAction SilentlyContinue
}

function Stop-DemoProcesses {
    param([string]$Dir, [int[]]$Ports)
    $pidFile = Join-Path $Dir "pids.json"
    if (Test-Path $pidFile) {
        try {
            $saved = Get-Content $pidFile -Raw | ConvertFrom-Json
            foreach ($savedId in @($saved.api, $saved.web, $saved.worker)) {
                if ($savedId) { Stop-ProcessTree -TargetId ([int]$savedId) }
            }
        } catch {
            Write-Host "No se pudo leer pids.json; se continuara por puerto." -ForegroundColor Yellow
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    foreach ($port in $Ports) {
        Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-ProcessTree -TargetId ([int]$_.OwningProcess) }
    }
    Start-Sleep -Milliseconds 600
}

function Remove-DemoDirectory {
    param([string]$Dir)
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            Remove-Item -Recurse -Force $Dir -ErrorAction Stop
            return
        } catch {
            if ($attempt -eq 10) {
                throw "No se pudo borrar '$Dir'. Cierra procesos que usen esa carpeta y reintenta. Detalle: $($_.Exception.Message)"
            }
            Start-Sleep -Milliseconds 700
        }
    }
}

Write-Host "Deteniendo cualquier demo previa en los puertos $ApiPort/$WebPort ..." -ForegroundColor Cyan
Stop-DemoProcesses -Dir $DemoDir -Ports @($ApiPort, $WebPort)

if ($Fresh -and (Test-Path $DemoDir)) {
    Write-Host "Borrando carpeta de demo: $DemoDir" -ForegroundColor Cyan
    Remove-DemoDirectory -Dir $DemoDir
}
foreach ($sub in @("uploads", "models", "tmp")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $DemoDir $sub) | Out-Null
}

$env:NEUROLAB_DEMO_DIR = $DemoDir
$env:NEUROLAB_DEMO_API = "$apiBase/api/v1"
$env:ENVIRONMENT = "development"
$env:DATABASE_URL = "sqlite+aiosqlite:///$($DemoDir -replace '\\', '/')/demo.db"
$env:DATA_DIR = (Join-Path $DemoDir "uploads")
$env:MODEL_DIR = (Join-Path $DemoDir "models")
$env:TEMP_DIR = (Join-Path $DemoDir "tmp")
$env:QUEUE_BACKEND = "filesystem"
$env:STORAGE_BACKEND = "local"
$env:SECRET_KEY = "demo_secret_key_neurolab_1234567890abcdef"
$env:SEED_ADMIN_EMAIL = "admin@neurolab.enterprise"
$env:SEED_ADMIN_PASSWORD = "Admin123!"
$env:SEED_ADMIN_NAME = "Administrador NeuroLab"
$env:LOGIN_RATE_LIMIT_PER_MINUTE = "10000"
$env:INFERENCE_REQUIRE_APPROVED = "false"
$env:WORKER_ID = "demo-worker-1"
$env:WORKER_HEARTBEAT_TIMEOUT_SECONDS = "900"
$env:QUEUE_POLL_SECONDS = "0.5"
$env:TF_CPP_MIN_LOG_LEVEL = "2"
$env:PYTHONUNBUFFERED = "1"
$env:VITE_API_URL = "$apiBase/api/v1"
# CORS debe incluir el puerto web real; si no, el login falla en puertos
# personalizados (por ejemplo 8010/5183) con "blocked by CORS policy".
$env:CORS_ORIGINS = "http://localhost:$WebPort,http://127.0.0.1:$WebPort"
$env:CORS_ORIGIN_REGEX = ""
# Con worker persistente el entrenamiento en vivo se lanza desde la UI.
if (-not $NoWorker) { $env:SEED_LIVE_JOB = "0" }

Write-Host "Carpeta de demo: $DemoDir" -ForegroundColor DarkGray
Write-Host "Arrancando API en $apiBase ..." -ForegroundColor Cyan
$api = Start-Process -FilePath "python" `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort") `
    -WorkingDirectory (Join-Path $repo "services\api") `
    -RedirectStandardOutput (Join-Path $DemoDir "api.log") `
    -RedirectStandardError (Join-Path $DemoDir "api.err.log") `
    -PassThru -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(120)
$healthy = $false
while (-not $healthy -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    try {
        $response = Invoke-RestMethod "$apiBase/health" -TimeoutSec 2
        $healthy = $response.status -eq "healthy"
    } catch {
        $healthy = $false
    }
}
if (-not $healthy) {
    throw "La API no arranco. Revise $(Join-Path $DemoDir 'api.err.log')"
}
Write-Host "API lista." -ForegroundColor Green

Write-Host "Sembrando datos de demostracion (incluye entrenamiento real)..." -ForegroundColor Cyan
& python (Join-Path $PSScriptRoot "seed_demo.py")
if ($LASTEXITCODE -ne 0) {
    throw "Fallo el sembrado de datos. Revise la salida anterior."
}

$worker = $null
if (-not $NoWorker) {
    Write-Host "Arrancando worker precalentado (TensorFlow tarda ~20 s en importar)..." -ForegroundColor Cyan
    $worker = Start-Process -FilePath "python" `
        -ArgumentList @("workers\training\worker.py") `
        -WorkingDirectory $repo `
        -RedirectStandardOutput (Join-Path $DemoDir "worker.log") `
        -RedirectStandardError (Join-Path $DemoDir "worker.err.log") `
        -PassThru -WindowStyle Hidden
}

Write-Host "Arrancando frontend en http://127.0.0.1:$WebPort ..." -ForegroundColor Cyan
$npm = (Get-Command npm.cmd).Source
$web = Start-Process -FilePath $npm `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$WebPort") `
    -WorkingDirectory (Join-Path $repo "apps\web") `
    -RedirectStandardOutput (Join-Path $DemoDir "web.log") `
    -RedirectStandardError (Join-Path $DemoDir "web.err.log") `
    -PassThru -WindowStyle Hidden

$webDeadline = (Get-Date).AddSeconds(120)
$webReady = $false
while (-not $webReady -and (Get-Date) -lt $webDeadline) {
    Start-Sleep -Milliseconds 800
    try {
        $probe = Invoke-WebRequest "http://127.0.0.1:$WebPort" -TimeoutSec 2 -UseBasicParsing
        $webReady = $probe.StatusCode -eq 200
    } catch {
        $webReady = $false
    }
}
if ($webReady) {
    Write-Host "Frontend listo." -ForegroundColor Green
} else {
    Write-Host "Advertencia: el frontend aun no responde. Revise $(Join-Path $DemoDir 'web.err.log')" -ForegroundColor Yellow
}

if ($worker) {
    # El logging de Python escribe en stderr; se revisan ambos archivos.
    $workerLogs = @((Join-Path $DemoDir "worker.log"), (Join-Path $DemoDir "worker.err.log"))
    $workerDeadline = (Get-Date).AddSeconds(120)
    $workerReady = $false
    while (-not $workerReady -and (Get-Date) -lt $workerDeadline) {
        Start-Sleep -Milliseconds 800
        foreach ($workerLog in $workerLogs) {
            if (Test-Path $workerLog) {
                if (Select-String -Path $workerLog -SimpleMatch "Training Worker activo" -Quiet) {
                    $workerReady = $true
                    break
                }
            }
        }
        $worker.Refresh()
        if ($worker.HasExited) { break }
    }
    if ($workerReady) {
        Write-Host "Worker listo y precalentado (los entrenamientos arrancan en segundos)." -ForegroundColor Green
    } else {
        Write-Host "Advertencia: el worker aun no esta listo. Revise $(Join-Path $DemoDir 'worker.log') y worker.err.log" -ForegroundColor Yellow
    }
}

$pids = @{ api = $api.Id; web = $web.Id; api_port = $ApiPort; web_port = $WebPort; demo_dir = $DemoDir }
if ($worker) { $pids.worker = $worker.Id }
$pids | ConvertTo-Json | Set-Content (Join-Path $DemoDir "pids.json")

Write-Host ""
Write-Host "Listo para la exposicion." -ForegroundColor Green
Write-Host "  Web:     http://127.0.0.1:$WebPort"
Write-Host "  API:     $apiBase"
Write-Host "  Swagger: $apiBase/api/v1/docs"
if ($worker) { Write-Host "  Worker:  persistente precalentado" } else { Write-Host "  Worker:  manual (scripts/run_worker_once.ps1)" }
Write-Host "  Admin:   admin@neurolab.enterprise / Admin123!"
Write-Host "  Revisor: revisor@instituto.edu / Revisor123!"
Write-Host ""
Write-Host "Para detener: powershell -ExecutionPolicy Bypass -File scripts/stop_demo.ps1 -DemoDir `"$DemoDir`""
