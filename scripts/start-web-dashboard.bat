@echo off
title Job Bot Web Control Dashboard
color 0B

echo ======================================================================
echo          🤖 ANTIGRAVITY JOB BOT - WEB CONTROL DASHBOARD
echo ======================================================================
echo  Candidate : Prakash Kumar Yadav
echo  Role      : Data Engineer (2.8+ Years Experience)
echo  Portals   : Direct Company Career Sites (Greenhouse, Lever, Ashby)
echo  Features  : 🌅 Morning Button (50 Jobs) ^| 🌙 Evening Button (50 Jobs)
echo  Freshness : Prioritizing Jobs Posted/Updated in the Last 1 Hour
echo  URL       : http://localhost:3333
echo ======================================================================
echo.

cd /d "%~dp0\.."

echo Opening Web Control Dashboard in your browser...
start http://localhost:3333

echo Starting dashboard server on port 3333...
node src/cli.js dashboard --port 3333

pause
