@echo off
rem ---------------------------------------------------------------------------
rem  Pulls the latest changes and rebuilds. Run this when told there is an
rem  update; the portal itself does not need it day to day.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo Fetching the latest version...
git pull origin claude/adoring-lamport-eqxudu || goto :failed

echo.
echo Installing any new dependencies...
call npm install || goto :failed

echo.
echo Rebuilding...
call npm run build || goto :failed

echo.
echo Up to date. Close this window and run start-portal to open the portal.
echo.
pause
goto :eof

:failed
echo.
echo That step failed - the message above says why.
echo.
pause
