@echo off
title 1-Click Master Job Hunt & Ranker
cls
echo ===================================================================
echo   RUNNING FULL AUTONOMOUS JOB APPLICATION & RANKING CYCLE
echo ===================================================================
echo.
echo Sequence:
echo   1. Naukri Resdex Daily Ranker Boost (Active Today)
echo   2. Instahyre Opportunity Applications
echo   3. ATS Direct Job Applications (Greenhouse / Lever / Ashby)
echo   4. Recruiter Cold Emails & Threaded Follow-Ups
echo.
cd /d "%~dp0"
node scripts\run_all_autonomous.mjs
echo.
echo Process completed. Press any key to exit.
pause >nul
