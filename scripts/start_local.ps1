# ==========================================================
# NEUROLAB ENTERPRISE - ARRANQUE LOCAL REAL (SIN DEMO)
# ==========================================================
# Usa la configuracion del .env de la raiz (Supabase/PostgreSQL por defecto) y
# arranca API + worker persistente + web. No crea ni siembra datos de demo:
# la base queda como este en el .env, solo con el administrador inicial.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1
#
# Opciones:
#   -ApiPort <n>   Puerto de la API (8012)
#   -WebPort <n>   Puerto del frontend (5185)
#   -NoWorker      No arranca el worker; los trabajos quedan en cola

param(
    [int]$ApiPort = 8012,
    [int]$WebPort = 5185,
    [switch]$NoWorker
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$runDir = Join-Path $env:TEMP "neurolab_local"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$apiBase = "http://127.0.0.1:$ApiPort"

if (-not (Test-Path (Join-Path $repo ".env"))) {
    throw "Falta el archivo .env en la raiz. Copie .env.local.example y ajustelo."
}

$pidFile = Join-Path $runDir "pids.json"
if (Test-Path $pidFile) {
    Write-Host "Deteniendo la instancia local anterior..." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot "stop_local.ps1")
}

function Wait-Http {
    param([string]$Url, [int]$TimeoutSeconds = 60, [string]$MustContain = "")
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                if (-not $MustContain -or $response.Content -like "*$MustContain*") { return $true }
            }
        } catch { }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

function Assert-PortFree {
    param([int]$Port, [string]$Name)
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($listener) {
        $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        throw "El puerto $Port ($Name) ya esta en uso por el proceso $($listener.OwningProcess) ($($proc.ProcessName)). Use -ApiPort o -WebPort para elegir otro."
    }
}

Assert-PortFree -Port $ApiPort -Name "API"
if ($WebPort -ne $ApiPort) { Assert-PortFree -Port $WebPort -Name "web" }

# CORS debe permitir el puerto web real elegido.
$env:CORS_ORIGINS = "http://localhost:$WebPort,http://127.0.0.1:$WebPort"
$env:CORS_ORIGIN_REGEX = ""
$env:VITE_API_URL = "$apiBase/api/v1"
$env:PYTHONUNBUFFERED = "1"
$env:TF_CPP_MIN_LOG_LEVEL = "2"

Write-Host "Arrancando API en $apiBase ..." -ForegroundColor Cyan
$api = Start-Process -FilePath "python" `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort") `
    -WorkingDirectory (Join-Path $repo "services\api") `
    -RedirectStandardOutput (Join-Path $runDir "api.log") `
    -RedirectStandardError (Join-Path $runDir "api.err.log") `
    -PassThru -WindowStyle Hidden

if (-not (Wait-Http -Url "$apiBase/health" -TimeoutSeconds 90 -MustContain "neurolab-api")) {
    throw "La API no respondio. Revise $(Join-Path $runDir 'api.err.log')."
}
Write-Host "API lista." -ForegroundColor Green

$worker = $null
if (-not $NoWorker) {
    Write-Host "Arrancando worker (TensorFlow tarda ~20 s en importar)..." -ForegroundColor Cyan
    $worker = Start-Process -FilePath "python" `
        -ArgumentList @("workers\training\worker.py") `
        -WorkingDirectory $repo `
        -RedirectStandardOutput (Join-Path $runDir "worker.log") `
        -RedirectStandardError (Join-Path $runDir "worker.err.log") `
        -PassThru -WindowStyle Hidden
}

Write-Host "Arrancando frontend en http://127.0.0.1:$WebPort ..." -ForegroundColor Cyan
$web = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$WebPort") `
    -WorkingDirectory (Join-Path $repo "apps\web") `
    -RedirectStandardOutput (Join-Path $runDir "web.log") `
    -RedirectStandardError (Join-Path $runDir "web.err.log") `
    -PassThru -WindowStyle Hidden

if (Wait-Http -Url "http://127.0.0.1:$WebPort" -TimeoutSeconds 90) {
    Write-Host "Frontend listo." -ForegroundColor Green
} else {
    Write-Host "Advertencia: el frontend aun no responde. Revise $(Join-Path $runDir 'web.err.log')" -ForegroundColor Yellow
}

if ($worker) {
    $workerLogs = @((Join-Path $runDir "worker.log"), (Join-Path $runDir "worker.err.log"))
    $deadline = (Get-Date).AddSeconds(120)
    $ready = $false
    while (-not $ready -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 800
        foreach ($log in $workerLogs) {
            if ((Test-Path $log) -and (Select-String -Path $log -SimpleMatch "Training Worker activo" -Quiet)) {
                $ready = $true
                break
            }
        }
        $worker.Refresh()
        if ($worker.HasExited) { break }
    }
    if ($ready) {
        Write-Host "Worker listo y precalentado." -ForegroundColor Green
    } else {
        Write-Host "Advertencia: el worker aun no esta listo. Revise $(Join-Path $runDir 'worker.err.log')" -ForegroundColor Yellow
    }
}

$pids = @{ api = $api.Id; web = $web.Id; api_port = $ApiPort; web_port = $WebPort; run_dir = $runDir }
if ($worker) { $pids.worker = $worker.Id }
# Se guarda la hora de arranque para que stop_local no confunda estos PID con
# procesos ajenos que Windows pudiera reutilizar tras un reinicio.
foreach ($entry in @(@{ key = 'api'; proc = $api }, @{ key = 'web'; proc = $web }, @{ key = 'worker'; proc = $worker })) {
    if ($entry.proc) {
        $pids["$($entry.key)_started"] = $entry.proc.StartTime.ToUniversalTime().ToString('o')
    }
}
$pids | ConvertTo-Json | Set-Content $pidFile

Write-Host ""
Write-Host "Aplicacion local lista (sin datos de demo):" -ForegroundColor Green
Write-Host "  Web:     http://127.0.0.1:$WebPort"
Write-Host "  API:     $apiBase"
Write-Host "  Swagger: $apiBase/api/v1/docs"
Write-Host "  Usuario: admin@neurolab.enterprise / Admin123!  (segun .env)"
Write-Host "  Logs:    $runDir"
Write-Host "  Parar:   powershell -ExecutionPolicy Bypass -File scripts/stop_local.ps1"
