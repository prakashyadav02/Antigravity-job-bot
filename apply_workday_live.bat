@echo off
title Workday Live Auto-Applier - M&G Prudential
cls
echo ===================================================================
echo   WORKDAY LIVE AUTO-APPLIER (HEADFUL VISIBLE BROWSER)
echo   Target: M&G Prudential - Senior Engineer Data (Pune)
echo ===================================================================
echo.
echo Launching Playwright Chromium window on your screen...
echo The bot will navigate, click Apply, select Autofill with Resume,
echo and attach your active resume (Prakash_Kumar_yadav.pdf).
echo.
cd /d "C:\Users\prakashkumar.y\Documents\job-automation-bot"
node scripts\apply_workday_live.mjs
echo.
echo Process complete. Press any key to exit.
pause >nul
