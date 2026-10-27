@echo off
title Featherless API-Key Eingabe
color 0E

set "TESTER_DIR=%~dp0..\..\KI-Tools\Forge-AI-Tester"
cd /d "%TESTER_DIR%"
node set-key.js

echo.
echo Taste druecken zum Schliessen...
pause >nul
