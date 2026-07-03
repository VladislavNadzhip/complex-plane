@echo off
cd /d "%~dp0"
title Complex Plane
echo.
echo  Complex Plane - production mode (no dev server)
echo.
call npm run build
if errorlevel 1 (
  echo  ERROR: build failed.
  pause
  exit /b 1
)
set COMPLEX_PLANE_DEV=0
call npx electron .
pause