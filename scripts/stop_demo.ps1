# Detiene los procesos de la demo local iniciados por start_demo.ps1.
# Incluye el arbol completo (npm -> cmd -> node), API, worker y respaldo por puerto.
param(
    [string]$DemoDir = (Join-Path $env:TEMP "neurolab_demo")
)

$DemoDir = [System.IO.Path]::GetFullPath($DemoDir)
$pidFile = Join-Path $DemoDir "pids.json"

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
    foreach ($savedId in @($saved.api, $saved.web, $saved.worker)) {
        if ($savedId) {
            Stop-ProcessTree -TargetId ([int]$savedId)
            Write-Host "Proceso $savedId detenido." -ForegroundColor Green
        }
    }
    foreach ($port in @($saved.api_port, $saved.web_port)) {
        if ($port) {
            Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue |
                ForEach-Object {
                    Stop-ProcessTree -TargetId ([int]$_.OwningProcess)
                    Write-Host "Puerto $port liberado." -ForegroundColor Green
                }
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "No se encontro $pidFile. No hay demo registrada en esa carpeta." -ForegroundColor Yellow
    Write-Host "Si quedo algo vivo, cierralo con: Get-NetTCPConnection -State Listen -LocalPort 8000,5173" -ForegroundColor Yellow
}

if ($found) {
    Write-Host "Demo detenida." -ForegroundColor Green
}
