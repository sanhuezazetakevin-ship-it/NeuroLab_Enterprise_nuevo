# Detiene la aplicacion local iniciada por start_local.ps1.
# Incluye el arbol completo (npm -> cmd -> node), API y worker.
param(
    [string]$RunDir = (Join-Path $env:TEMP "neurolab_local")
)

$pidFile = Join-Path $RunDir "pids.json"

function Stop-ProcessTree {
    param([int]$TargetId)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $TargetId } |
        ForEach-Object { Stop-ProcessTree -TargetId ([int]$_.ProcessId) }
    Stop-Process -Id $TargetId -Force -ErrorAction SilentlyContinue
}

function Test-OwnProcess {
    # Comprueba que el PID siga siendo el proceso que arrancamos. Windows puede
    # reutilizar un PID tras un reinicio; matarlo a ciegas afectaria a otro
    # programa. Si no hay hora guardada (instancia antigua), se confia en el PID.
    param([int]$TargetId, [string]$StartedAt)
    $proc = Get-Process -Id $TargetId -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    if (-not $StartedAt) { return $true }
    try {
        $expected = [datetime]::Parse($StartedAt).ToUniversalTime()
        $actual = $proc.StartTime.ToUniversalTime()
        return [math]::Abs(($actual - $expected).TotalSeconds) -lt 3
    } catch {
        return $false
    }
}

$found = $false
if (Test-Path $pidFile) {
    $found = $true
    $saved = Get-Content $pidFile -Raw | ConvertFrom-Json
    # Solo se detienen los procesos que arrancamos nosotros. No se toca el
    # propietario de un puerto por si otra aplicacion lo ocupa.
    foreach ($name in @('api', 'web', 'worker')) {
        $savedId = $saved.$name
        if (-not $savedId) { continue }
        $started = $saved."$($name)_started"
        if (Test-OwnProcess -TargetId ([int]$savedId) -StartedAt $started) {
            Stop-ProcessTree -TargetId ([int]$savedId)
            Write-Host "Proceso $savedId ($name) detenido." -ForegroundColor Green
        } else {
            Write-Host "Proceso $savedId ($name) ya no existe o no coincide; se omite." -ForegroundColor DarkGray
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not $found) {
    Write-Host "No hay una instancia local registrada en $RunDir." -ForegroundColor Yellow
}
