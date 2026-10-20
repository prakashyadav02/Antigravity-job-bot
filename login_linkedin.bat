@echo off
title LinkedIn Review Helper - Job Automation Bot
cls
echo ===================================================================
echo   LINKEDIN 1-CLICK LOGIN HELPER
echo ===================================================================
echo.
echo Launching Google Chrome window...
echo Please log in to your secondary LinkedIn account.
echo The session will be saved automatically to data\linkedin_storage_state.json.
echo.
echo NOTE:
echo The bot will ONLY use this session to discover external job URLs and recruiter emails.
echo It will NEVER use Easy Apply on LinkedIn.
echo.
cd /d "C:\Users\prakashkumar.y\Documents\job-automation-bot"
node scripts\login_linkedin.mjs
echo.
echo Process finished. Press any key to close this window.
pause >nul
