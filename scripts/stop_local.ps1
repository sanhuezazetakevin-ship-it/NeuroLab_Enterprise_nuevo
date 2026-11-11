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

$found = $false
if (Test-Path $pidFile) {
    $found = $true
    $saved = Get-Content $pidFile -Raw | ConvertFrom-Json
    # Solo se detienen los procesos que arrancamos nosotros. No se toca el
    # propietario de un puerto por si otra aplicacion lo ocupa.
    foreach ($savedId in @($saved.api, $saved.web, $saved.worker)) {
        if ($savedId) {
            Stop-ProcessTree -TargetId ([int]$savedId)
            Write-Host "Proceso $savedId detenido." -ForegroundColor Green
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not $found) {
    Write-Host "No hay una instancia local registrada en $RunDir." -ForegroundColor Yellow
}
