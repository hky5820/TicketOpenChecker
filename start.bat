@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=3000; while ((Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) -and $p -lt 3020) { $p++ }; Write-Output $p"') do set APP_PORT=%%P

echo Starting TicketOpenChecker: http://localhost:%APP_PORT%
start "TicketOpenChecker Server" cmd /k "cd /d ""%~dp0"" && set ""PORT=%APP_PORT%"" && npm start"
timeout /t 2 /nobreak >nul
start "" "http://localhost:%APP_PORT%"

endlocal
