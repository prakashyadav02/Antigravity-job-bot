# 🚀 Personal Laptop Setup & Remote Mobile Control Guide

This guide explains how to run your autonomous Job Bot on your **Personal Laptop** and access the live dashboard from your **Mobile Phone** from anywhere.

---

## 📁 Step 1: Copy to Your Personal Laptop
1. Copy the `job-automation-bot-backup.zip` file (created on your Desktop) to a USB Drive or upload it to your Google Drive.
2. Download and extract (unzip) it on your personal laptop (e.g., in `C:\job-automation-bot` or your Documents folder).

---

## ⚙️ Step 2: 1-Click Installation (2 Minutes)
1. Make sure **Node.js** (LTS version) is installed on your personal laptop. If not, download and install it in 1 minute from [nodejs.org](https://nodejs.org).
2. Double-click **`setup-personal-laptop.bat`**.
3. It will automatically install all dependencies and browser binaries.

*All your saved login sessions (`Naukri`, `Instahyre`), your passwords in `.env`, and your PDF resume are already included inside the folder, so you don't have to log in again!*

---

## 📱 Step 3: Remote Mobile Control (Via Cloudflare Tunnel)
To monitor and control the bot from your smartphone while away from home:

1. Double-click **`start-remote-dashboard.bat`**.
2. It starts your local dashboard server on port 3333, prevents laptop sleep, and launches a secure Cloudflare Tunnel.
3. Look at the terminal window — you will see a public link like:
   `https://random-words.trycloudflare.com`
4. **Open that link on your Mobile Phone!**
5. Bookmark it on your phone's browser. You can now view applied jobs, see stats, and trigger application runs from anywhere in the world!

---

## 🤖 Step 4: Daily Automation (Zero Effort)
* **To run an immediate full job hunt cycle:** Double-click `run-instant-job-hunt.bat`.
* **To keep it running on a schedule:** Double-click `scripts\start-daily-autopilot.bat`.
