import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGreenhouseOtp } from '../email/otpFetcher.js';
import { waitForConfirmationEmail } from '../email/confirmationVerifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEBUG_DIR = path.resolve(__dirname, '../../data/debug');

if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

/**
 * Inspects the current page DOM to find validation errors,
 * missing mandatory inputs, unchecked consent boxes, or stuck modals.
 */
export async function inspectPageErrors(page) {
  const issues = [];

  try {
    // 1. Text validation error messages on screen
    const errorLocators = [
      '.field-error',
      '.error',
      '.validation-error',
      '[role="alert"]',
      '.error-message',
      '.alert-danger',
      '.inline-error',
      '.invalid-feedback',
      'p[class*="error"]',
      'span[class*="error"]',
      'div[class*="error"]'
    ];

    for (const sel of errorLocators) {
      const elements = await page.locator(sel).all().catch(() => []);
      for (const el of elements) {
        if (await el.isVisible().catch(() => false)) {
          const txt = (await el.innerText().catch(() => '')).trim();
          if (txt && txt.length < 160 && !issues.includes(txt)) {
            issues.push(txt);
          }
        }
      }
    }

    // 2. Browser native :invalid or aria-invalid elements
    const invalidInputs = await page.locator('input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"]').all().catch(() => []);
    for (const input of invalidInputs) {
      if (await input.isVisible().catch(() => false)) {
        const name = await input.getAttribute('name') || await input.getAttribute('id') || 'unnamed';
        const label = await input.evaluate(el => el.closest('div.field, label, div')?.innerText || '').catch(() => '');
        const cleanLabel = label.split('\n')[0].slice(0, 60).trim();
        issues.push(`Unfilled/Invalid field: "${name}" (${cleanLabel})`);
      }
    }

    // 3. Check for security verification modal (8-character code)
    const securityInput = page.locator('#security-input-0');
    if (await securityInput.isVisible().catch(() => false)) {
      issues.push('Greenhouse 8-character verification code modal is open');
    }

    // 4. Check for captcha
    const captcha = page.locator('iframe[src*="recaptcha"], iframe[src*="challenges.cloudflare"], iframe[src*="hcaptcha"]');
    if (await captcha.count().catch(() => 0) > 0) {
      issues.push('Captcha challenge present on page');
    }

    // 5. Check for unchecked consent checkboxes
    const checkboxes = await page.locator('input[type="checkbox"]').all().catch(() => []);
    for (const cb of checkboxes) {
      if (await cb.isVisible().catch(() => false)) {
        const checked = await cb.isChecked().catch(() => false);
        if (!checked) {
          const label = await cb.evaluate(el => el.parentElement?.innerText || '').catch(() => '');
          if (label.toLowerCase().includes('consent') || label.toLowerCase().includes('agree') || label.toLowerCase().includes('required')) {
            issues.push(`Unchecked consent box: "${label.slice(0, 60).trim()}"`);
          }
        }
      }
    }

  } catch (err) {
    issues.push(`Diagnostics probe error: ${err.message}`);
  }

  return issues;
}

/**
 * Saves a high-resolution screenshot and DOM text snapshot for debugging
 */
export async function captureDebugSnapshot(page, companyName) {
  const timestamp = Date.now();
  const cleanName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const screenshotPath = path.resolve(DEBUG_DIR, `debug_${cleanName}_${timestamp}.png`);
  const snapshotPath = path.resolve(DEBUG_DIR, `debug_${cleanName}_${timestamp}.txt`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const bodyText = await page.locator('body').innerText().catch(() => '');
    fs.writeFileSync(snapshotPath, bodyText, 'utf-8');
    return { screenshotPath, snapshotPath };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Automatically applies fixes based on detected errors, re-submits,
 * and waits for confirmation email.
 */
export async function autoDebugAndRemediate(page, job, profile, options = {}) {
  const { timeoutSeconds = 90 } = options;
  const companyName = job.companyName || job.company;

  console.log(`\n=============================================================`);
  console.log(`🔧 [AUTO-DEBUGGER] Application confirmation not yet detected!`);
  console.log(`Diagnosing root cause for: "${job.title}" @ ${companyName}...`);
  console.log(`=============================================================\n`);

  // Step 1: Capture screenshot snapshot
  const snapshot = await captureDebugSnapshot(page, companyName);
  if (snapshot.screenshotPath) {
    console.log(`📸 [Snapshot Saved]: ${snapshot.screenshotPath}`);
  }

  // Step 2: Probe DOM for validation errors and missing fields
  const issues = await inspectPageErrors(page);

  if (issues.length > 0) {
    console.log(`🔍 [Issues Discovered (${issues.length})]:`);
    issues.forEach((iss, i) => console.log(`   ${i + 1}. ${iss}`));
  } else {
    console.log(`ℹ️ [DOM Inspection]: No explicit validation error found on page.`);
    console.log(`Checking if employer mail queue is simply delayed...`);
  }

  // Fast Exit on Security Challenge / Captcha
  const hasCaptcha = issues.some(iss => iss.toLowerCase().includes('captcha'));
  if (hasCaptcha) {
    console.warn(`\n🛑 [Captcha Security Challenge Detected] Form requires interactive human CAPTCHA verification.`);
    console.warn(`Skipping ${companyName} immediately to prevent batch delay...\n`);
    return {
      fixed: false,
      confirmed: false,
      error: 'Captcha challenge present on page',
      issues,
      screenshotPath: snapshot.screenshotPath
    };
  }

  // Fast On-Screen Confirmation Check
  const currentBody = await page.locator('body').innerText().catch(() => '');
  const isAlreadyConfirmed = currentBody.includes('Thank you') || 
                             currentBody.includes('Thanks for applying') || 
                             currentBody.includes('Application Submitted') || 
                             currentBody.includes('received your application') || 
                             page.url().toLowerCase().includes('thank') ||
                             page.url().toLowerCase().includes('confirmation');
  if (isAlreadyConfirmed) {
    console.log(`🎉 [ATS Confirmed On-Screen] Confirmation detected on screen for ${companyName}!`);
    return {
      fixed: true,
      confirmed: true,
      subject: 'On-Screen ATS Confirmation ("Thanks for applying!")',
      from: companyName,
      receivedAt: new Date().toISOString(),
      issues
    };
  }

  // Step 3: Self-Healing Remediation
  console.log(`\n🛠️ [Self-Healing] Applying fixes to unresolved fields...`);
  let fixesApplied = 0;

  // Wait if submit button is currently spinning / processing
  const isSpinning = await page.locator('.spinner, [class*="spinner"], button[disabled]').count().catch(() => 0);
  if (isSpinning > 0) {
    console.log('   [Debugger] Detected active loading spinner. Waiting up to 15s for transition...');
    for (let w = 0; w < 10; w++) {
      await page.waitForTimeout(1500);
      const stillSpinning = await page.locator('.spinner, [class*="spinner"]').count().catch(() => 0);
      const secInput = await page.locator('#security-input-0').isVisible().catch(() => false);
      if (!stillSpinning || secInput) break;
    }
  }

  // A. Check all consent checkboxes
  const checkboxes = await page.locator('input[type="checkbox"]').all().catch(() => []);
  for (const cb of checkboxes) {
    if (await cb.isVisible().catch(() => false)) {
      const checked = await cb.isChecked().catch(() => false);
      if (!checked) {
        console.log(`   [Fix] Checking consent checkbox...`);
        await cb.check({ force: true }).catch(() => cb.click({ force: true }));
        fixesApplied++;
      }
    }
  }

  // B. Fill any empty required inputs or fields with validation errors
  const invalidInputs = await page.locator('input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"]').all().catch(() => []);
  for (const input of invalidInputs) {
    if (await input.isVisible().catch(() => false)) {
      const name = (await input.getAttribute('name') || '').toLowerCase();
      const id = (await input.getAttribute('id') || '').toLowerCase();
      const label = (await input.evaluate(el => el.closest('div.field, label, div')?.innerText || '')).toLowerCase();

      console.log(`   [Fix] Providing value for missing field: ${name || id}`);
      if (name.includes('email') || id.includes('email')) {
        await input.fill(profile.personal.email).catch(() => {});
      } else if (name.includes('phone') || id.includes('phone')) {
        await input.fill(profile.personal.phone).catch(() => {});
      } else if (label.includes('linkedin') || name.includes('linkedin')) {
        await input.fill(profile.links.linkedin).catch(() => {});
      } else if (label.includes('github') || name.includes('github')) {
        await input.fill(profile.links.github).catch(() => {});
      } else if (label.includes('portfolio') || label.includes('website')) {
        await input.fill(profile.links.portfolio).catch(() => {});
      } else if (label.includes('experience') || name.includes('experience')) {
        await input.fill('3').catch(() => {});
      } else if (label.includes('location') || label.includes('city')) {
        await input.fill(profile.personal.currentLocation || 'Noida, India').catch(() => {});
      } else if (label.includes('notice')) {
        await input.fill('30 days').catch(() => {});
      } else {
        await input.fill('Yes').catch(() => {});
      }
      fixesApplied++;
    }
  }

  // C. Handle Greenhouse 8-character OTP prompt if open
  const securityInput = page.locator('#security-input-0');
  if (await securityInput.isVisible().catch(() => false)) {
    console.log(`   [Fix] 8-character verification modal open. Fetching code from Gmail...`);
    const appPass = process.env.GMAIL_APP_PASSWORD;
    const code = await fetchGreenhouseOtp({
      email: profile.personal.email,
      appPassword: appPass,
      timeoutMs: 50000,
      submittedAfter: Date.now() - 120000
    });
    if (code) {
      console.log(`   [Fix] Entering fetched code: ${code}...`);
      for (let i = 0; i < 8; i++) {
        await page.locator(`#security-input-${i}`).fill(code[i]).catch(() => {});
        await page.waitForTimeout(100);
      }
      const verifyBtn = page.locator('#submit_app, button[type="submit"], button:has-text("Submit"), button:has-text("Verify")').first();
      if (await verifyBtn.count().catch(() => 0) > 0) {
        await verifyBtn.click().catch(() => {});
        await page.waitForTimeout(6000);
      }
      fixesApplied++;
    }
  }

  // Step 4: Re-Submit form if fixes were applied or if confirmation not yet reached
  const submitStartTime = Date.now();
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const isAlreadyConfirmedAtResubmit = bodyText.includes('Thank you') || bodyText.includes('Application Submitted') || bodyText.includes('received') || page.url().includes('thank');

  if (!isAlreadyConfirmedAtResubmit && fixesApplied > 0) {
    console.log(`\n🚀 [Self-Healing] Re-submitting form after applying ${fixesApplied} fixes...`);
    const submitButton = page.locator('#submit_app, button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit")').first();
    if (await submitButton.count().catch(() => 0) > 0) {
      await submitButton.scrollIntoViewIfNeeded().catch(() => {});
      await submitButton.click({ force: true }).catch(() => {});
      await page.waitForTimeout(6000);
    }
  }

  // Step 4b: Check immediately after re-submitting before polling email
  const postSubmitBody = await page.locator('body').innerText().catch(() => '');
  const isPostSubmitConfirmed = postSubmitBody.includes('Thank you') || 
                               postSubmitBody.includes('Thanks for applying') || 
                               postSubmitBody.includes('Application Submitted') || 
                               postSubmitBody.includes('received your application') || 
                               page.url().toLowerCase().includes('thank') ||
                               page.url().toLowerCase().includes('confirmation');
  if (isPostSubmitConfirmed) {
    console.log(`🎉 [ATS Confirmed On-Screen] Confirmation detected on screen after fixes for ${companyName}!`);
    return {
      fixed: true,
      confirmed: true,
      subject: 'On-Screen ATS Confirmation ("Thanks for applying!")',
      from: companyName,
      receivedAt: new Date().toISOString(),
      issues
    };
  }

  // Step 5: Wait again for confirmation email from site (capped at 20s max)
  const waitTimeout = Math.min(timeoutSeconds, 20);
  console.log(`\n⏳ [Confirmation Verifier] Re-polling Gmail for official site receipt (${waitTimeout}s max)...`);
  const verificationResult = await waitForConfirmationEmail({
    companyName,
    jobTitle: job.title,
    submittedAfter: submitStartTime - 30000,
    timeoutSeconds: waitTimeout
  });

  if (verificationResult.confirmed) {
    console.log(`\n🎉 [AUTO-DEBUG SUCCESS!]`);
    console.log(`Issue resolved! Official site confirmation email received:`);
    console.log(`Subject: "${verificationResult.subject}"`);
    console.log(`From: ${verificationResult.from}`);
    console.log(`Proceeding to next job with verified confirmation!\n`);
    return {
      fixed: true,
      confirmed: true,
      subject: verificationResult.subject,
      from: verificationResult.from,
      receivedAt: verificationResult.receivedAt,
      issues
    };
  } else {
    console.warn(`\n🛑 [AUTO-DEBUG INCONCLUSIVE]`);
    console.warn(`Even after diagnostics and fixes, site confirmation email did not arrive.`);
    console.warn(`Halting batch immediately as instructed. No next job will be executed without confirmed email receipt.\n`);
    return {
      fixed: false,
      confirmed: false,
      error: verificationResult.error || 'No confirmation email received after debugging',
      issues,
      screenshotPath: snapshot.screenshotPath
    };
  }
}
