@echo off
REM Day1Care Backend — Detached Launcher
REM
REM Starts backend as a fully orphaned process (parent dies immediately) so it
REM survives any Cursor agent / shell exit. Logs go to backend.log.
REM
REM Usage:
REM   scripts\start_backend_detached.bat
REM
REM To stop:  scripts\stop_backend.bat
REM To tail:  type backend.log

setlocal
set "ROOT=%~dp0.."
pushd "%ROOT%"

REM Detect if already running on :8787
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [start_backend_detached] Backend already listening on :8787
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
        echo [start_backend_detached] Existing PID: %%P
    )
    popd
    endlocal
    exit /b 0
)

set "PY=C:\Users\HLC\AppData\Local\Programs\Python\Python311\python.exe"
set "LOG=%ROOT%\backend.log"

echo [start_backend_detached] Starting backend detached; logs to %LOG%

REM Use PowerShell Process.Start with no window, no inherited console,
REM stdout/stderr redirected to a file. The PowerShell process exits immediately
REM after Start() returns, leaving python.exe orphaned and detached.
powershell -NoProfile -Command "Start-Process -FilePath '%PY%' -ArgumentList 'start_backend.py' -WorkingDirectory '%ROOT%' -RedirectStandardOutput '%LOG%' -RedirectStandardError '%LOG%.err' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id"

REM Poll up to 20s for the listener
set /a i=0
:wait
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL%==0 goto ready
set /a i+=1
if %i% gtr 40 (
    echo [start_backend_detached] ERROR: Backend did not start within 20s. Check %LOG% / %LOG%.err
    popd
    endlocal
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait
:ready

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
    echo [start_backend_detached] Backend ready. PID: %%P. Logs: %LOG%
)

popd
endlocal
