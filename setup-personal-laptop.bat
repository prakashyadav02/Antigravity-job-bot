@echo off
title 1-Click Setup - Job Automation Bot for Personal Laptop
cls
echo ===================================================================
echo   JOB AUTOMATION BOT - PERSONAL LAPTOP SETUP INSTALLER
echo ===================================================================
echo.
echo Checking for Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js (LTS version) from:
    echo https://nodejs.org
    echo.
    echo After installing Node.js, run this file again.
    pause
    exit /b 1
)

echo [OK] Node.js found:
node -v
echo.
echo Installing project dependencies (npm install)...
call npm install
echo.
echo Installing Playwright Chrome browser binaries...
call npx playwright install chrome
echo.
echo ===================================================================
echo   SETUP COMPLETED SUCCESSFULLY!
echo ===================================================================
echo.
echo You can now run:
echo   1. start-remote-dashboard.bat  (Access dashboard from your mobile phone)
echo   2. start-daily-autopilot.bat   (Run the full job application cycle)
echo.
pause
