@echo off
title HipiPlayRD - Instalador v6 Balance
echo ===============================================
echo Instalando dependencias de HipiPlayRD Server v6 Balance...
echo ===============================================
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ERROR: Node.js no esta instalado.
  echo Descarga e instala Node.js LTS desde:
  echo https://nodejs.org/
  pause
  exit /b
)
npm install
echo.
echo Instalacion completada.
pause
