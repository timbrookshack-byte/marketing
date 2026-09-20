@echo off
rem ---------------------------------------------------------------------------
rem  Creates (or removes) a Startup shortcut, so the portal runs at login.
rem
rem  Doing this by hand means a shortcut wizard, a path typed correctly, and
rem  remembering to set it minimised. This does all three from wherever the
rem  project happens to live.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "TARGET=%~dp0start-portal.cmd"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\360 Marketing.lnk"

if /i "%~1"=="remove" (
  if exist "%LINK%" (
    del "%LINK%"
    echo Removed. The portal will no longer start at login.
  ) else (
    echo There was no Startup shortcut to remove.
  )
  echo.
  pause
  goto :eof
)

if not exist "%TARGET%" (
  echo Cannot find start-portal.cmd next to this file. Run update-portal first.
  echo.
  pause
  goto :eof
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%');" ^
  "$s.TargetPath = '%TARGET%';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.Description = '360 Marketing portal';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Save()" || goto :failed

echo.
echo Done. The portal will start minimised at login, at http://localhost:3000
echo.
echo To undo this, run:  install-startup.cmd remove
echo.
pause
goto :eof

:failed
echo.
echo Could not create the shortcut - the message above says why.
echo.
pause
