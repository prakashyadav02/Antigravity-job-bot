@echo off
title Antigravity Job Bot - 30-Minute Auto-Pilot
cd /d "%~dp0\.."

echo ============================================================
echo   🤖 ANTIGRAVITY JOB BOT - 30-MINUTE AUTONOMOUS AUTOPILOT
echo ============================================================
echo   - Boosts Naukri Profile & SEO Headline every 30 mins
echo   - Applies to fresh 2-5 YOE Data Engineer jobs (human-paced)
echo   - Sends direct recruiter outreach & follow-ups
echo   - Press Ctrl+C to terminate anytime
echo ============================================================
echo.

node src/cli.js autopilot-30m

pause
