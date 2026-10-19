# Readiness check: backend /ready, agent credential, Vision /health, Ollama model. Claims no jobs.
#   powershell -ExecutionPolicy Bypass -File scripts\check_agent.ps1 [-EnvFile agent.env] [-Python PATH]
param(
    [string]$EnvFile = '',
    [string]$Python = 'D:\AI\Envs\CareLens-VLM\Scripts\python.exe'
)
$root = Split-Path $PSScriptRoot -Parent
if (-not $EnvFile) { $EnvFile = Join-Path $root 'agent.env' }
$env:PYTHONPATH = Join-Path $root 'src'
& $Python -m carelens_agent check --env-file $EnvFile
exit $LASTEXITCODE
