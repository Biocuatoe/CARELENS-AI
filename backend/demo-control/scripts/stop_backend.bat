@echo off
REM Day1Care Backend — Stop helper
setlocal
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL%==1 (
    echo [stop_backend] No backend listening on :8787
    endlocal
    exit /b 0
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
    echo [stop_backend] Stopping PID %%P
    taskkill /PID %%P /F >nul 2>&1
)
endlocal
