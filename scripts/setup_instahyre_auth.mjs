import { createBrowser, randomSleep } from '../src/automation/browser.js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/instahyre_storage_state.json');
const ENV_PATH = path.resolve(__dirname, '../.env');

// Generate a strong random password for Instahyre
const NEW_PASSWORD = 'Vivek@Tech' + Math.floor(1000 + Math.random() * 9000) + '!';

async function fetchResetLink(submittedAfter) {
  const email = process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com';
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass },
    logger: false
  });

  await client.connect();
  console.log('[IMAP] Connected to Gmail. Waiting for Instahyre password reset email...');

  const startTime = Date.now();
  let resetUrl = null;

  while (Date.now() - startTime < 90000) { // wait up to 90s
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messages = await client.search({
        from: 'instahyre.com',
        since: new Date(Date.now() - 5 * 60 * 1000)
      }, { uid: true });

      if (messages.length > 0) {
        // check from newest to oldest
        for (let i = messages.length - 1; i >= 0; i--) {
          const uid = messages[i];
          const raw = await client.download(uid);
          const parsed = await simpleParser(raw.content);
          
          if (parsed.subject?.toLowerCase().includes('password') || parsed.text?.includes('reset') || parsed.html?.includes('reset')) {
            const body = parsed.html || parsed.text || '';
            const match = body.match(/https:\/\/[^\s"']+instahyre\.com\/[^\s"']*reset[^\s"']*/i);
            if (match) {
              resetUrl = match[0].replace(/&amp;/g, '&');
              console.log('[IMAP] Found Reset URL:', resetUrl);
              break;
            }
          }
        }
      }
    } finally {
      lock.release();
    }

    if (resetUrl) break;
    await new Promise(r => setTimeout(r, 4000));
  }

  await client.logout();
  return resetUrl;
}

async function main() {
  console.log('🚀 Initiating Autonomous Instahyre Authentication Setup...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome'
  });

  try {
    const userEmail = process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com';

    // 1. Trigger Reset Password
    console.log('Navigating to Instahyre reset password page...');
    await page.goto('https://www.instahyre.com/reset_password/', { waitUntil: 'domcontentloaded' });
    await randomSleep(2000, 3000);

    await page.fill('input#email', userEmail);
    console.log(`Filled email: ${userEmail}`);
    await randomSleep(1000, 1500);

    const submitBtn = page.locator('button:has-text("Submit"), input[type="submit"]').first();
    const beforeSubmitTime = Date.now();
    await submitBtn.click();
    console.log('Clicked Submit on reset password form.');
    await randomSleep(3000, 4000);

    // 2. Fetch reset link from Gmail IMAP
    const resetUrl = await fetchResetLink(beforeSubmitTime);
    if (!resetUrl) {
      throw new Error('Failed to retrieve password reset link from Gmail.');
    }

    // 3. Open reset URL and set NEW_PASSWORD
    console.log('Opening password reset link in browser...');
    await page.goto(resetUrl, { waitUntil: 'domcontentloaded' });
    await randomSleep(3000, 4000);

    // Look for new password inputs
    const passInput = page.locator('input[type="password"]').first();
    await passInput.waitFor({ state: 'visible', timeout: 10000 });
    await passInput.fill(NEW_PASSWORD);
    console.log('Filled new password.');

    const passConfirmInput = page.locator('input[type="password"]').nth(1);
    if (await passConfirmInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await passConfirmInput.fill(NEW_PASSWORD);
    }
    await randomSleep(1000, 1500);

    // Click submit button
    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Submit"), button:has-text("Reset"), button[type="submit"]').first();
    await saveBtn.click();
    console.log('Saved new password.');
    await randomSleep(4000, 6000);

    // 4. Log in with the new password
    console.log('Logging in with updated credentials...');
    await page.goto('https://www.instahyre.com/login/', { waitUntil: 'domcontentloaded' });
    await randomSleep(2000, 3000);

    await page.fill('input#email', userEmail);
    await page.fill('input#password', NEW_PASSWORD);
    await randomSleep(1000, 1500);

    await page.click('button.btn-filled.success.btn-xl, button:has-text("Log in")');
    await randomSleep(5000, 7000);

    const currentUrl = page.url();
    console.log('Post-login URL:', currentUrl);

    // Save session storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`✅ Instahyre Session successfully saved to: ${STORAGE_STATE_PATH}`);

    // Update .env with INSTAHYRE_PASSWORD
    let envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    if (!envContent.includes('INSTAHYRE_PASSWORD=')) {
      envContent += `\nINSTAHYRE_PASSWORD=${NEW_PASSWORD}\n`;
    } else {
      envContent = envContent.replace(/INSTAHYRE_PASSWORD=.*/, `INSTAHYRE_PASSWORD=${NEW_PASSWORD}`);
    }
    fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
    console.log('✅ Updated .env with INSTAHYRE_PASSWORD.');

  } catch (err) {
    console.error('Error during Instahyre setup:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
