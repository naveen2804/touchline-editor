@echo off
title Build Touchline Studio installer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( pause & exit /b 1 )
)

echo.
echo Building the Windows installer (a few minutes)...
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo Build failed. If the error mentions "symbolic link", turn on Windows
  echo Developer Mode ^(Settings ^> System ^> For developers^) and run this again.
  pause
  exit /b 1
)

echo.
echo Done! "Touchline Studio Setup 1.0.0.exe" is in the dist folder.
explorer dist
pause
