@echo off
title Job Bot Dashboard & Remote Mobile Access
cls
echo ===================================================================
echo   STARTING JOB BOT DASHBOARD WITH REMOTE MOBILE ACCESS
echo ===================================================================
echo.
echo Local Dashboard: http://localhost:3333
echo.
echo 1. Starting Dashboard Server in background...
start /B node src\cli.js dashboard --port 3333
echo.
echo 2. Locking Screen Sleep Awake (Background)...
start /B powershell -ExecutionPolicy Bypass -File scripts\keep-screen-awake.ps1
echo.
echo 3. Generating Secure Public URL via Cloudflare Tunnel...
echo    (This will give you an HTTPS link you can open on your PHONE!)
echo ===================================================================
echo.
npx cloudflared tunnel --url http://localhost:3333
pause
