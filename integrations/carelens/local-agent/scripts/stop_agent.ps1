# Stop a background agent gracefully: request stop, wait up to 30 s, then terminate.
#   powershell -ExecutionPolicy Bypass -File scripts\stop_agent.ps1
$root = Split-Path $PSScriptRoot -Parent
$run = Join-Path $root 'run'
$pidFile = Join-Path $run 'agent.pid'
if (-not (Test-Path $pidFile)) { Write-Output 'No agent.pid: agent not started in background.'; exit 0 }
$agentPid = Get-Content $pidFile
$proc = Get-Process -Id $agentPid -ErrorAction SilentlyContinue
if (-not $proc) { Remove-Item $pidFile; Write-Output 'Agent not running.'; exit 0 }
New-Item -ItemType File -Force (Join-Path $run 'stop.request') | Out-Null
if (-not $proc.WaitForExit(30000)) {
    Write-Output 'Agent did not stop within 30 s; terminating. Its job lease will expire and be retried by the backend.'
    Stop-Process -Id $agentPid -Force
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
Write-Output "Agent stopped (PID $agentPid)."
