import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/linkedin_storage_state.json');

async function main() {
  console.log('====================================================');
  console.log('🌐 OPENING SECURE LINKEDIN WINDOW...');
  console.log('👉 Screen par Chrome window open ho rahi hai.');
  console.log('   Apna LinkedIn account log in kar lo.');
  console.log('   Jaise hi login ho jayega, session automatically save');
  console.log('   hoga aur window safely close ho jayegi.');
  console.log('====================================================\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });

  const context = await browser.newContext({
    viewport: null
  });

  const page = await context.newPage();

  // Safeguard: Capture session if user closes window after logging in
  page.on('close', async () => {
    try {
      const url = page.url();
      if (!url.includes('/login') && !url.includes('/checkpoint')) {
        await context.storageState({ path: STORAGE_STATE_PATH });
        console.log(`✅ LinkedIn Session saved on window close: ${STORAGE_STATE_PATH}`);
      }
    } catch {}
  });

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  try {
    const emailField = page.locator('#username, input[name="session_key"]').first();
    const passField = page.locator('#password, input[name="session_password"]').first();
    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in")').first();

    const email = process.env.LINKEDIN_EMAIL || process.env.GMAIL_USER || '';
    const pass = process.env.LINKEDIN_PASSWORD || '';

    if (email && await emailField.isVisible({ timeout: 4000 }).catch(() => false)) {
      await emailField.fill(email);
    }
    if (pass && await passField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await passField.fill(pass);
      console.log('🔑 Auto-populated secondary login credentials. Submitting...');
      await submitBtn.click().catch(() => {});
    }
  } catch {}

  console.log('⏳ Waiting for you to complete LinkedIn sign-in (waiting up to 5 minutes)...');

  const startTime = Date.now();
  let saved = false;
  while (Date.now() - startTime < 300000) {
    if (page.isClosed()) {
      break;
    }
    const url = page.url();
    const isFeedOrProfile = url.includes('/feed') || url.includes('/in/') || url.includes('/mynetwork') || url.includes('/jobs') || url.includes('/messaging');
    const isLogin = url.includes('/login') || url.includes('/checkpoint') || url.includes('/uas') || url.includes('/challenge');

    let hasLiAt = false;
    try {
      const cookies = await context.cookies();
      hasLiAt = cookies.some(c => c.name === 'li_at' && c.value);
    } catch {}

    if ((hasLiAt || isFeedOrProfile) && !isLogin) {
      console.log('\n🎉 LinkedIn Login detected successfully!');
      await page.waitForTimeout(3000);
      await context.storageState({ path: STORAGE_STATE_PATH });
      console.log(`✅ LinkedIn Session saved to: ${STORAGE_STATE_PATH}`);
      saved = true;
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!saved) {
    console.warn('⚠️ Login timeout reached (5 mins). Session not saved.');
  }

  await browser.close().catch(() => {});
}

main().catch(console.error);
