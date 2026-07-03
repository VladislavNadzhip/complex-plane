@echo off
cd /d "%~dp0\.."
echo [%date% %time%] Starting Vite... > vite.log
call npm run dev >> vite.log 2>&1
echo [%date% %time%] Vite exited with code %ERRORLEVEL% >> vite.log