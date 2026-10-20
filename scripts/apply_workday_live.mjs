import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESUME_PATH = path.resolve(__dirname, '../data/Prakash_Kumar_yadav.pdf');

async function main() {
  console.log('===================================================================');
  console.log('🚀 WORKDAY LIVE AUTOMATION: M&G PRUDENTIAL (DATA ENGINEER)');
  console.log('Target: Senior Engineer - Data | Pune, India');
  console.log('Resume:', RESUME_PATH);
  console.log('Candidate: Prakash Kumar Yadav (yadavparkash02@gmail.com)');
  console.log('===================================================================\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    console.log('🌐 Step 1: Loading Workday job page...');
    await page.goto('https://mgpru.wd3.myworkdayjobs.com/mandgprudential/job/Pune/Senior-Engineer---Data_R19785', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await page.waitForTimeout(3000);

    // Accept Cookies
    const cookieBtn = page.locator('[data-automation-id="legalNoticeAcceptButton"], button:has-text("Accept Cookies")').first();
    if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('🍪 Accepted cookie policy.');
      await cookieBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Click Apply
    console.log('🖱️ Step 2: Clicking Apply button...');
    const applyBtn = page.locator('[data-automation-id="adventureButton"], a:has-text("Apply"), button:has-text("Apply")').first();
    await applyBtn.waitFor({ state: 'visible', timeout: 15000 });
    await applyBtn.click();
    await page.waitForTimeout(3000);

    // Click Autofill with Resume
    console.log('📄 Step 3: Selecting "Autofill with Resume"...');
    const autofillBtn = page.locator('[data-automation-id="autofillWithResume"], a:has-text("Autofill with Resume")').first();
    await autofillBtn.waitFor({ state: 'visible', timeout: 10000 });
    await autofillBtn.click();
    await page.waitForTimeout(4000);

    // Step 4: Workday Account Gate
    console.log('🔐 Step 4: Waiting for Workday Account form...');
    const emailField = page.locator('[data-automation-id="email"], input[type="email"], #input-4').first();
    await emailField.waitFor({ state: 'visible', timeout: 25000 });

    const candidateEmail = 'yadavparkash02@gmail.com';
    const strongPass = 'PrakashWorkday@2026!';

    console.log(`Pre-filling Workday Account for ${candidateEmail}...`);
    await emailField.fill(candidateEmail);

    const passField = page.locator('[data-automation-id="password"], input[type="password"]').first();
    if (await passField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await passField.fill(strongPass);
    }

    const verifyPassField = page.locator('[data-automation-id="verifyPassword"]').first();
    if (await verifyPassField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await verifyPassField.fill(strongPass);
    }

    // Consent checkboxes
    const checkboxes = await page.locator('input[type="checkbox"]').all();
    for (const cb of checkboxes) {
      await cb.check({ force: true }).catch(() => {});
    }

    const createAccountBtn = page.locator('div[aria-label="Create Account"], [data-automation-id="createAccountSubmitButton"], button:has-text("Create Account")').first();
    if (await createAccountBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Submitting Account Creation / Login...');
      await createAccountBtn.click({ force: true });
      await page.waitForTimeout(6000);
    }

    // Check if error: account already exists
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes('already exists') || bodyText.includes('Sign In')) {
      console.log('Account already exists! Clicking Sign In...');
      const signInLink = page.locator('[data-automation-id="signInLink"], button:has-text("Sign In"), a:has-text("Sign In")').first();
      if (await signInLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await signInLink.click({ force: true });
        await page.waitForTimeout(3000);
        await emailField.fill(candidateEmail).catch(() => {});
        await passField.fill(strongPass).catch(() => {});
        const signInSubmit = page.locator('div[aria-label="Sign In"], [data-automation-id="signInSubmitButton"], button:has-text("Sign In")').first();
        if (await signInSubmit.isVisible({ timeout: 3000 }).catch(() => false)) {
          await signInSubmit.click({ force: true });
          await page.waitForTimeout(6000);
        }
      }
    }

    // Step 5: Upload Resume
    console.log('📎 Step 5: Checking for Resume Upload dropzone...');
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible({ timeout: 10000 }).catch(() => false) || await fileInput.count() > 0) {
      console.log(`Attaching resume: ${path.basename(RESUME_PATH)}...`);
      await fileInput.setInputFiles(RESUME_PATH);
      console.log('✅ Resume attached! Waiting for Workday AI to parse document...');
      await page.waitForTimeout(8000);

      // Click Continue to My Information
      const nextBtn = page.locator('[data-automation-id="bottom-navigation-next-button"], button:has-text("Continue"), button:has-text("Next")').first();
      if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('Advancing to My Information...');
        await nextBtn.click();
        await page.waitForTimeout(6000);
      }
    }

    // Capture progress screenshot
    await page.screenshot({ path: 'workday_filled_state.png', fullPage: true });

    console.log('\n===================================================================');
    console.log('🎉 PROGRESS: Workday application opened and details filled live!');
    console.log('Window is active on your screen. Keeping open so you can review & submit.');
    console.log('===================================================================\n');

    await page.waitForTimeout(240000); // Keep open 4 minutes

  } catch (err) {
    console.error(`❌ Application trace: ${err.message}`);
    await page.screenshot({ path: 'workday_error.png', fullPage: true }).catch(() => {});
    await page.waitForTimeout(30000);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
