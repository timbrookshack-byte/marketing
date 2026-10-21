@echo off
rem ---------------------------------------------------------------------------
rem  Pulls the latest changes and rebuilds. Run this when told there is an
rem  update; the portal itself does not need it day to day.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

rem  npm install rewrites package-lock.json with entries for this machine's
rem  platform, which then blocks the next pull as a local change nobody made on
rem  purpose. Discarding that one file is safe: the next install rewrites it
rem  again. Nothing else is touched, so real edits are still protected.
git checkout -- package-lock.json 2>nul

echo Fetching the latest version...
git pull origin claude/adoring-lamport-eqxudu || goto :conflict

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

:conflict
echo.
echo The pull stopped because files here differ from the repository. The message
echo above names them. If they are files you did not deliberately change, run:
echo.
echo     git checkout -- ^<filename^>
echo.
echo and try again. If you did change them on purpose, say so before discarding.
echo.
pause
goto :eof

:failed
echo.
echo That step failed - the message above says why.
echo.
pause
