@echo off
title Naukri Profile Login - Job Automation Bot
cls
echo ===================================================================
echo   NAUKRI 1-CLICK AUTHENTICATION HELPER
echo ===================================================================
echo.
echo Launching Google Chrome window for Naukri login...
echo.
cd /d "%~dp0"
node scripts\login_naukri.mjs
echo.
echo Process finished. Press any key to close this window.
pause >nul
