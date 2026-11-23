@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preview.ps1" %*
if errorlevel 1 (
  echo.
  echo Preview failed. See the message above and README.md.
  pause
  exit /b 1
)
