@echo off
cd /d "%~dp0"
title Complex Plane
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause