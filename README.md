# Autonomous AI Job Application Engine

An automated, stealth-enabled job application engine designed specifically for direct company ATS portals (**Greenhouse** & **Lever**).

### Why Direct ATS?
* **Zero Account Ban Risk**: You apply directly to company career boards without logging into a centralized personal account (unlike LinkedIn).
* **Stealth Interactions**: Uses human-like typing cadences, random pauses, and anti-detection flags.
* **Intelligent Auto-fill**: Fills candidate info, links, resumes, EEOC disclosures, and custom screening questions via Gemini AI.
* **Duplicate Prevention**: Tracks every submission in a local database so you never apply twice to the same job.

---

## 🛠️ Quick Setup

1. **Install dependencies**:
   ```powershell
   npm install
   npx playwright install chromium
   ```

2. **Configure your profile**:
   Open [`config/profile.json`](config/profile.json) and enter:
   - Your name, email, phone number, and location.
   - Your LinkedIn, GitHub, and portfolio URLs.
   - The path to your actual PDF resume (e.g. `C:\\Users\\...\\Resume.pdf`).
   - Your target roles, locations, notice period, and standard screening answers.

3. *(Optional)* **Set up Gemini for custom question answering**:
   Copy `.env.example` to `.env` and set your `GEMINI_API_KEY`:
   ```env
   GEMINI_API_KEY=your_key_here
   ```

---

## 🚀 How to Run

### 1. Test Application with Dry Run (Safe Preview)
Pre-fills the form so you can see it with your own eyes, without clicking final submit:
```powershell
node src/cli.js apply "<greenhouse-or-lever-job-url>" --dry-run
```

### 2. Autonomous Apply to a Single Job (Live)
Fills the form, uploads resume, answers questions, and autonomously submits:
```powershell
node src/cli.js apply "<greenhouse-or-lever-job-url>"
```

### 3. Scan a Company Board for Matching Open Roles
Fetches all open roles for a company and filters them according to your preferences in `profile.json`:
```powershell
# Scan Greenhouse company (e.g., figma, stripe, datadog, discord)
node src/cli.js scan figma --ats greenhouse

# Scan Lever company (e.g., netflix, spotify)
node src/cli.js scan netflix --ats lever
```

### 4. Fully Autonomous Batch Mode
Scans multiple companies, identifies matching roles, and applies to each with human-paced intervals:
```powershell
node src/cli.js auto-apply figma datadog stripe --max 5
```

### 5. Check Applied History
```powershell
node src/cli.js history
```
