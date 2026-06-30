@echo off
title HipiPlayRD v6 - Probar endpoints
echo Estado publico:
curl http://localhost:4000/api/state
echo.
echo Historial PWA:
curl http://localhost:4000/api/history
echo.
pause
