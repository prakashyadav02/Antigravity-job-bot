import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('====================================================');
  console.log('🌐 OPENING NAUKRI LOGIN WINDOW...');
  console.log('👉 Please log in to Naukri in the browser window.');
  console.log('   Once logged in, the session will be saved automatically');
  console.log('   and this window will close!');
  console.log('====================================================\n');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  await page.goto('https://www.naukri.com/nlogin/login');

  const email = process.env.NAUKRI_EMAIL || process.env.GMAIL_USER || '';
  const password = process.env.NAUKRI_PASSWORD || '';
  try {
    const emailField = page.locator('#usernameField, input[placeholder*="Username" i]').first();
    if (await emailField.isVisible({ timeout: 5000 })) {
      await emailField.fill(email);
    }
    if (password) {
      const passField = page.locator('#passwordField, input[type="password"]').first();
      if (await passField.isVisible({ timeout: 3000 })) {
        await passField.fill(password);
      }
    }
  } catch {}

  console.log('⏳ Waiting for you to complete sign-in (waiting up to 5 minutes)...');

  const startTime = Date.now();
  let saved = false;

  while (Date.now() - startTime < 300000) {
    const url = page.url();
    const isProfile = url.includes('/mnjuser/profile') || url.includes('/mnjuser/homepage');
    const isLogin = url.includes('/nlogin') || url.includes('/login') || url.includes('login?');
    
    if (isProfile || (!isLogin && await page.locator('.user-name, [title="View profile"], .nI-gNb-drawer__bars').first().count() > 0)) {
      console.log('\n🎉 Login detected successfully!');
      await page.waitForTimeout(3000);
      await context.storageState({ path: STORAGE_STATE_PATH });
      console.log(`✅ Session saved to: ${STORAGE_STATE_PATH}`);
      console.log('✨ All future profile boosts can now run 100% autonomously in the background!');
      saved = true;
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close().catch(() => {});
  if (!saved) {
    console.log('⚠️ Login timed out or window was closed before completing login.');
  }
}

main().catch(console.error);
