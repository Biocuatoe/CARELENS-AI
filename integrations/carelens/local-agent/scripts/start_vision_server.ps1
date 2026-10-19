# Start the installed CareLens Vision package API on this PC only (127.0.0.1:8080).
#   powershell -ExecutionPolicy Bypass -File scripts\start_vision_server.ps1 [-Device cuda|cpu|auto] [-Background]
# Wraps the package's own scripts\start_server.ps1 without modifying it. Never passes -SaveDir (which would
# store real frames on disk) and never binds a LAN address: only the local agent calls this API.
param(
    [ValidateSet('auto', 'cpu', 'cuda')][string]$Device = 'cuda',
    [switch]$Background,
    [string]$Package = 'D:\AI\Models\CareLens-VLM\carelens_models_v1_20261018',
    [string]$Python = 'D:\AI\Envs\CareLens-VLM\Scripts\python.exe'
)
$ErrorActionPreference = 'Stop'
$script = Join-Path $Package 'scripts\start_server.ps1'
if (-not (Test-Path $script)) { Write-Error "Vision package not found at $Package"; exit 2 }
$argList = @('-ExecutionPolicy', 'Bypass', '-File', $script, '-Device', $Device, '-BindHost', '127.0.0.1', '-Port', '8080', '-Python', $Python)
if ($Background) {
    $p = Start-Process powershell -ArgumentList $argList -WindowStyle Hidden -PassThru
    Write-Output "Vision server starting in background (launcher PID $($p.Id)). Poll http://127.0.0.1:8080/health until it answers."
} else {
    & powershell @argList
    exit $LASTEXITCODE
}
