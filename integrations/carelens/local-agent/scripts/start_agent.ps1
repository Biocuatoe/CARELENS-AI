# Start the CareLens Local AI Agent.
#   powershell -ExecutionPolicy Bypass -File scripts\start_agent.ps1 [-EnvFile agent.env] [-Background] [-Python PATH]
# Foreground: Ctrl+C stops it. Background: hidden process, PID in run\agent.pid, stop with scripts\stop_agent.ps1.
# Uses the existing Python of the Vision environment by default (standard library only; nothing is installed).
# Does not register a Windows service, change system settings, or open any inbound port.
param(
    [string]$EnvFile = '',
    [switch]$Background,
    [string]$Python = 'D:\AI\Envs\CareLens-VLM\Scripts\python.exe'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $EnvFile) { $EnvFile = Join-Path $root 'agent.env' }
if (-not (Test-Path $EnvFile)) { Write-Error "Env file not found: $EnvFile (copy agent.env.example)"; exit 2 }
if (-not (Test-Path $Python)) { Write-Error "Python not found: $Python"; exit 2 }
$run = Join-Path $root 'run'
New-Item -ItemType Directory -Force $run | Out-Null
$env:PYTHONPATH = Join-Path $root 'src'
$agentArgs = @('-m', 'carelens_agent', 'run', '--env-file', $EnvFile)
if ($Background) {
    $pidFile = Join-Path $run 'agent.pid'
    if (Test-Path $pidFile) {
        $old = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { Write-Output "Agent already running (PID $old)"; exit 0 }
    }
    $p = Start-Process -FilePath $Python -ArgumentList $agentArgs -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $run 'agent.out') -RedirectStandardError (Join-Path $run 'agent.err') -PassThru
    Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
    Write-Output "Agent started in background (PID $($p.Id)). Log: $run\agent.log"
} else {
    & $Python @agentArgs
    exit $LASTEXITCODE
}
