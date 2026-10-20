import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function testLogin() {
  const email = process.env.LINKEDIN_EMAIL;
  const pass = process.env.LINKEDIN_PASSWORD;
  console.log('Testing login for secondary ID:', email);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const emailField = page.locator('#username, input[name="session_key"]').first();
  const passField = page.locator('#password, input[name="session_password"]').first();
  const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in")').first();

  await emailField.fill(email);
  await page.waitForTimeout(500);
  await passField.fill(pass);
  await page.waitForTimeout(500);
  await submitBtn.click();

  await page.waitForTimeout(7000);
  const currentUrl = page.url();
  const pageTitle = await page.title().catch(() => '');
  console.log('Current URL after submit:', currentUrl);
  console.log('Page Title:', pageTitle);

  if (currentUrl.includes('/feed') || currentUrl.includes('/in/') || currentUrl.includes('/mynetwork') || currentUrl.includes('/jobs')) {
    const storagePath = path.resolve('data/linkedin_storage_state.json');
    await context.storageState({ path: storagePath });
    console.log('🎉 SUCCESS: LinkedIn session saved to:', storagePath);
  } else if (currentUrl.includes('/checkpoint') || currentUrl.includes('/challenge')) {
    console.log('⚠️ Security checkpoint / verification triggered by LinkedIn. Requires visible browser (login_linkedin.bat).');
  } else {
    console.log('⚠️ URL state:', currentUrl);
  }

  await browser.close();
}

testLogin().catch(console.error);
