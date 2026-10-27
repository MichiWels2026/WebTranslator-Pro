@echo off
title Forge WebTRANSLATOR OmniLingo PRO - KI Agent Test
color 0A

echo ========================================================
echo   FORGE WEBTRANSLATOR OMNILINGO PRO - 1-KLICK KI-AGENTEN TEST
echo   Startet den autonomen Chrome Tester
echo ========================================================
echo.

set "TESTER_DIR=%~dp0..\..\KI-Tools\Forge-AI-Tester"

if not exist "%TESTER_DIR%\index.js" (
    echo [FEHLER] Forge AI-Tester nicht gefunden unter:
    echo "%TESTER_DIR%"
    echo.
    pause
    exit /b 1
)

cd /d "%TESTER_DIR%"
node index.js --live

echo.
echo Testlauf abgeschlossen. Taste druecken zum Schliessen...
pause >nul
