import { createBrowser, randomSleep } from '../src/automation/browser.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/instahyre_storage_state.json');
const ENV_PATH = path.resolve(__dirname, '../.env');
import 'dotenv/config';

const EMAIL = process.env.INSTAHYRE_EMAIL || process.env.GMAIL_USER || '';
const PASSWORD = process.env.INSTAHYRE_PASSWORD || '';

async function main() {
  console.log('🚀 Logging in to Instahyre with direct credentials...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome'
  });

  try {
    await page.goto('https://www.instahyre.com/login/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(2000, 3000);

    console.log('Page Title:', await page.title());

    // Fill credentials
    const emailInput = page.locator('input#email').first();
    await emailInput.waitFor({ state: 'visible', timeout: 8000 });
    await emailInput.fill(EMAIL);
    await randomSleep(500, 800);

    const passInput = page.locator('input#password').first();
    await passInput.fill(PASSWORD);
    await randomSleep(800, 1200);

    // Click Log in
    const loginBtn = page.locator('button.btn-filled.success.btn-xl, button:has-text("Log in")').first();
    await loginBtn.click();
    console.log('Clicked Log in button, waiting for redirect...');

    await randomSleep(5000, 7000);

    const postLoginUrl = page.url();
    const postLoginTitle = await page.title();
    console.log('Post-login URL:', postLoginUrl);
    console.log('Post-login Title:', postLoginTitle);

    // Check for error messages if any
    const errorMsg = await page.evaluate(() => {
      const err = document.querySelector('.alert-danger, .error-message, .text-danger, .ng-binding.text-danger');
      return err?.innerText?.trim();
    });

    if (errorMsg) {
      console.warn('⚠️ Login Message:', errorMsg);
    }

    const isLoggedIn = postLoginUrl.includes('/candidate/') || !postLoginUrl.includes('/login');
    console.log('Is Logged In:', isLoggedIn);

    if (isLoggedIn) {
      // Save session storage state
      await context.storageState({ path: STORAGE_STATE_PATH });
      console.log(`✅ Session saved to: ${STORAGE_STATE_PATH}`);

      // Save to .env
      let envContent = fs.readFileSync(ENV_PATH, 'utf-8');
      if (!envContent.includes('INSTAHYRE_PASSWORD=')) {
        envContent += `\nINSTAHYRE_PASSWORD=${PASSWORD}\n`;
      } else {
        envContent = envContent.replace(/INSTAHYRE_PASSWORD=.*/, `INSTAHYRE_PASSWORD=${PASSWORD}`);
      }
      fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
      console.log('✅ INSTAHYRE_PASSWORD saved in .env.');
    }

  } catch (err) {
    console.error('Error during Instahyre login:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
