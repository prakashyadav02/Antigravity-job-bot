@echo off
title Job Bot Daily Auto-Pilot Scheduler
color 0A

echo ======================================================================
echo          🤖 ANTIGRAVITY JOB BOT - DAILY AUTO-PILOT SCHEDULER
echo ======================================================================
echo  Candidate : Prakash Kumar Yadav
echo  Role      : Data Engineer (2.8+ Years Experience)
echo  Schedule  : Runs Automatically Every 1 Hour (0 * * * *)
echo  Target    : India Hubs (Bengaluru, Noida, Gurugram, Pune, Hyderabad, Remote)
echo  Resume    : Prakash-Kumar-Yadav-Resume.pdf (Latest Version)
echo  Email     : yadavparkash02@gmail.com (Daily Summary & OTP Intercept)
echo ======================================================================
echo.

cd /d "%~dp0\.."

echo Starting background hourly auto-pilot scheduler...
node src/cli.js schedule --cron "0 * * * *" --max 10 --now

pause
