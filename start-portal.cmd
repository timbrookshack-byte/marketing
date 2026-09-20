@echo off
rem ---------------------------------------------------------------------------
rem  360 Marketing - double-click to open the portal.
rem
rem  Installs and builds only when they are actually missing, so the usual
rem  launch is just the server starting. The browser is opened by a second
rem  process that waits for the port to answer, because opening it immediately
rem  shows "connection refused" and looks like a failure.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing dependencies. This happens once, and takes a few minutes.
  call npm install || goto :failed
)

if not exist ".next\BUILD_ID" (
  echo Building. This happens once after each update.
  call npm run build || goto :failed
)

echo.
echo   360 Marketing is starting on http://localhost:3000
echo   Leave this window open while you use it. Close it to stop the portal.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command ^
  "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing 'http://localhost:3000' -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Milliseconds 500 } }"

call npm start
goto :eof

:failed
echo.
echo That step failed - the message above says why. This window stays open so
echo you can read it.
echo.
pause
