import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { loadProfile } from '../config.js';
import { createBrowser, randomSleep } from './browser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../../data/naukri_storage_state.json');
const LOG_FILE = path.resolve(__dirname, '../../data/naukri_rank_log.json');
export function getResumePath() {
  try {
    const profile = loadProfile();
    if (profile?.documents?.resumePath) return profile.documents.resumePath;
  } catch {}
  return path.resolve(__dirname, '../../data/Prakash-Kumar-Yadav-Resume.pdf');
}

export function getNaukriRankLogs() {
  if (fs.existsSync(LOG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

export function saveNaukriRankLog(entry) {
  const logs = getNaukriRankLogs();
  logs.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

export function isNaukriSessionSaved() {
  return fs.existsSync(STORAGE_STATE_PATH);
}

/**
 * Checks if current page is an authenticated Naukri user page
 */
export async function isLoggedIn(page) {
  try {
    const url = page.url();
    if (url.includes('/nlogin') || url.includes('/login') || url.includes('login?')) {
      return false;
    }
    const parsed = new URL(url);
    if (parsed.pathname.includes('/mnjuser/profile') || parsed.pathname.includes('/mnjuser/homepage')) {
      return true;
    }
    const indicator = await page.locator('.nI-gNb-drawer__bars, .user-name, [title="View profile"], .nI-gNb-header__wrapper').first().count();
    return indicator > 0;
  } catch {
    return false;
  }
}

/**
 * Headless autonomous login using credentials from .env
 */
export async function loginHeadless(email, password) {
  console.log(`\n🔑 [Naukri Autonomous Login] Starting headless login for ${email}...`);
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome'
  });

  try {
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'networkidle', timeout: 35000 });
    await randomSleep(2000, 3000);

    const emailField = page.locator('#usernameField, input[placeholder*="Username" i], input[type="email"]').first();
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.click();
    await emailField.fill(email);
    console.log(`📧 Filled username: ${email}`);

    const passwordField = page.locator('#passwordField, input[type="password"]').first();
    await passwordField.waitFor({ state: 'visible', timeout: 5000 });
    await passwordField.click();
    await passwordField.fill(password);
    console.log(`🔒 Filled password.`);

    const submitBtn = page.locator('button[type="submit"], button:has-text("Login")').first();
    await submitBtn.click();
    console.log('🚀 Clicked login button. Awaiting authentication...');

    const startTime = Date.now();
    while (Date.now() - startTime < 20000) {
      if (await isLoggedIn(page)) {
        await randomSleep(2000, 3000);
        await context.storageState({ path: STORAGE_STATE_PATH });
        console.log(`🎉 [Naukri Login Success] Session saved to: ${STORAGE_STATE_PATH}`);
        return { success: true };
      }
      await randomSleep(1500, 2000);
    }

    const err = await page.locator('.server-err, .err, [class*="error" i]').first().textContent().catch(() => null);
    if (err) console.error(`❌ Naukri error response: ${err.trim()}`);
    return { success: false, error: err || 'Authentication timeout or challenge encountered.' };
  } catch (err) {
    console.error(`❌ Headless login failed: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Opens a headful browser window and guides the user to log in.
 * Once logged in, saves storageState.json permanently.
 */
export async function launchNaukriLoginWindow() {
  console.log('\n============================================================');
  console.log('🌐 OPENING NAUKRI LOGIN WINDOW ON YOUR SCREEN...');
  console.log('👉 Please log in using Google, Password, or OTP in the opened window.');
  console.log('============================================================\n');

  const { browser, context, page } = await createBrowser({
    headless: false,
    channel: 'chrome',
    slowMo: 50
  });

  try {
    console.log('Navigating to Naukri login page...');
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(2000, 3000);

    const profile = loadProfile();
    const email = process.env.NAUKRI_EMAIL || profile?.personal?.email || '';

    // Pre-fill email identifier
    try {
      const emailField = page.locator('#usernameField, input[placeholder*="Username" i], input[type="email"]').first();
      if (await emailField.isVisible({ timeout: 4000 })) {
        await emailField.click();
        await emailField.fill(email);
        console.log(`📧 Pre-filled your email: ${email}`);
      }
    } catch {}

    console.log('\n⏳ Waiting for you to complete login in the opened browser window...');
    console.log('(Window will stay open for up to 3 minutes for you to complete sign-in)\n');

    const startTime = Date.now();
    let loggedIn = false;

    while (Date.now() - startTime < 180000) {
      if (await isLoggedIn(page)) {
        loggedIn = true;
        console.log('🎉 Login detected successfully!');
        break;
      }
      await randomSleep(2000, 3000);
    }

    if (loggedIn) {
      // Save full session state (cookies, local storage, tokens)
      await context.storageState({ path: STORAGE_STATE_PATH });
      console.log(`✅ Session saved to: ${STORAGE_STATE_PATH}`);
      console.log('✨ All future daily rank boosts will run automatically without needing login!');
      await randomSleep(3000, 4000);
      return { success: true, message: 'Logged in and session saved successfully!' };
    } else {
      throw new Error('Login timed out after 3 minutes. Please try again.');
    }

  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Updates the Resume Headline on Naukri to trigger the "Updated Today" recruiter boost
 */
async function updateResumeHeadline(page) {
  console.log('\n📝 [Naukri Boost 1/2] Refreshing Resume Headline...');

  if (!page.url().includes('/mnjuser/profile')) {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(2500, 3500);
  }

  // Look for Edit button for Resume Headline
  const editSelectors = [
    '.resumeHeadline .edit',
    '[class*="resumeHeadline"] [class*="edit"]',
    'div:has-text("Resume headline") button:has-text("edit")',
    'div:has-text("Resume headline") span:has-text("Edit")',
    'span.edit:has-text("edit")',
    '.widgetHead:has-text("Resume headline") .edit'
  ];

  let clicked = false;
  for (const sel of editSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        clicked = true;
        break;
      }
    } catch {}
  }

  if (!clicked) {
    console.warn('⚠️ Edit button not found immediately. Looking for textarea...');
  }

  await randomSleep(1500, 2500);

  const textarea = page.locator('textarea#resumeHeadlineTxt, textarea[placeholder*="headline" i], .resumeHeadlineTxt').first();
  if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
    const currentText = (await textarea.inputValue().catch(() => '')) || '';
    
    const profile = loadProfile();
    const role = profile.experience?.currentTitle || profile.workPreferences?.targetRoles?.[0] || 'Software Engineer';
    const yoe = profile.experience?.totalYears || '2.8+';
    const skillsList = profile.customAnswers?.primarySkills
      ? profile.customAnswers.primarySkills.split(',').slice(0, 6).map(s => s.trim()).join(', ')
      : 'Python, PySpark, SQL, Airflow, Spark';
    const notice = `${profile.workPreferences?.effectiveNoticePeriodDays || 15} Days Notice`;
    const targetHeadline = `${role} | ${yoe} Yrs | ${skillsList} | Pan-India & Remote | ${notice}`;
    
    let newHeadline = targetHeadline;
    if (currentText.trim() === targetHeadline.trim()) {
      newHeadline = targetHeadline.endsWith('.') ? targetHeadline.slice(0, -1) : `${targetHeadline}.`;
    }

    await textarea.click();
    await textarea.fill(newHeadline);
    console.log(`✅ Set updated headline: "${newHeadline}"`);
    await randomSleep(1000, 2000);

    const saveBtn = page.locator('form[name="resumeHeadlineForm"] button[type="submit"], button:has-text("Save"), .btn-save').first();
    if (await saveBtn.isVisible({ timeout: 3000 })) {
      await saveBtn.click();
      console.log('💾 Clicked Save on Resume Headline!');
      await randomSleep(3000, 4500);
      return { success: true, action: 'headline_updated', headline: newHeadline };
    }
  }

  return { success: false, action: 'headline_failed' };
}

/**
 * Re-uploads candidate's latest PDF resume to trigger the "Resume Updated Today" badge
 */
async function refreshResumeUpload(page) {
  console.log('\n📄 [Naukri Boost 2/2] Re-uploading Resume to trigger "Resume Updated Today" badge...');

  const resumePath = getResumePath();
  if (!fs.existsSync(resumePath)) {
    console.warn(`⚠️ Resume file not found at: ${resumePath}`);
    return { success: false, reason: 'file_not_found' };
  }

  if (!page.url().includes('/mnjuser/profile')) {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(2000, 3000);
  }

  try {
    const fileInput = page.locator('input[type="file"]#attachCV, input[type="file"][name*="resume" i], input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(resumePath);
      console.log(`📤 Attached ${path.basename(resumePath)} to upload input.`);
      await randomSleep(4000, 6000);
      console.log('✅ Resume re-uploaded successfully to Naukri!');
      return { success: true, action: 'resume_uploaded' };
    }
  } catch (err) {
    console.error('❌ Resume upload error:', err.message);
  }

  return { success: false, action: 'resume_upload_failed' };
}

/**
 * Main Daily Ranker Orchestrator:
 * If no session is saved, opens login window.
 * If session is saved, executes daily profile touch and resume re-upload!
 */
export async function runNaukriDailyRanker(options = {}) {
  const { headless = false, action = 'all', forceLogin = false } = options;

  console.log('\n============================================================');
  console.log('🚀 NAUKRI.COM DAILY TOP-RANKER ENGINE');
  console.log('Goal: Refresh profile timestamps to rank #1 on recruiter searches');
  console.log(`Session File: ${STORAGE_STATE_PATH}`);
  console.log('============================================================\n');

  const profile = loadProfile();
  const email = process.env.NAUKRI_EMAIL || profile?.personal?.email || '';
  const password = process.env.NAUKRI_PASSWORD;

  // Check if session exists
  if (!isNaukriSessionSaved() || forceLogin) {
    if (password) {
      console.log(`🔑 No active session found. Running headless auto-login using NAUKRI_PASSWORD for ${email}...`);
      const authRes = await loginHeadless(email, password);
      if (!authRes.success) {
        return { 
          status: 'AUTH_FAILED', 
          message: `Naukri headless login failed: ${authRes.error || 'Check credentials'}. Or double-click login_naukri.bat.` 
        };
      }
    } else {
      console.log('🔑 No saved session found and NAUKRI_PASSWORD is not set in .env.');
      return { 
        status: 'AUTH_REQUIRED', 
        message: 'Naukri authentication required. Please add NAUKRI_PASSWORD to .env, or double-click login_naukri.bat in the bot folder to log in once.' 
      };
    }
  }

  console.log('🚀 Loading saved session and navigating to profile...');
  const { browser, context, page } = await createBrowser({
    headless,
    storageState: STORAGE_STATE_PATH
  });

  const results = {
    timestamp: new Date().toISOString(),
    actionsCompleted: [],
    status: 'PENDING'
  };

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(2000, 3500);

    // If redirected to login, session has expired
    if (!await isLoggedIn(page)) {
      console.warn('⚠️ Session expired.');
      await browser.close().catch(() => {});
      if (password) {
        console.log('Re-authenticating with NAUKRI_PASSWORD...');
        const authRes = await loginHeadless(email, password);
        if (authRes.success) {
          return await runNaukriDailyRanker(options);
        }
      }
      return { 
        status: 'AUTH_REQUIRED', 
        message: 'Naukri session expired. Please add NAUKRI_PASSWORD to .env or double-click login_naukri.bat to refresh session.' 
      };
    }

    if (action === 'all' || action === 'headline') {
      const res = await updateResumeHeadline(page);
      if (res.success) results.actionsCompleted.push('headline_updated');
    }

    if (action === 'all' || action === 'resume') {
      const res = await refreshResumeUpload(page);
      if (res.success) results.actionsCompleted.push('resume_uploaded');
    }

    // Save refreshed session state
    await context.storageState({ path: STORAGE_STATE_PATH });

    results.status = results.actionsCompleted.length > 0 ? 'SUCCESS' : 'NO_CHANGES';
    console.log(`\n🎉 [Naukri Ranker Completed] Status: ${results.status}`);
    console.log(`Actions: ${results.actionsCompleted.join(', ') || 'None'}`);

  } catch (err) {
    results.status = 'ERROR';
    results.error = err.message;
    console.error(`\n❌ [Naukri Ranker Error]: ${err.message}`);
  } finally {
    saveNaukriRankLog(results);
    await browser.close().catch(() => {});
  }

  return results;
}
