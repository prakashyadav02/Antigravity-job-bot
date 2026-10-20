import fs from 'fs';
import { humanType, randomSleep } from './browser.js';
import { answerCustomQuestion } from '../ai/fieldMatcher.js';
import { fetchGreenhouseOtp } from '../email/otpFetcher.js';

export async function applyToGreenhouse(page, url, profile, options = {}) {
  const { dryRun = false } = options;
  let targetUrl = url;
  const ghJidMatch = url.match(/[?&]gh_jid=(\d+)/);
  if (ghJidMatch && !url.includes('greenhouse.io')) {
    const domainMatch = url.match(/https?:\/\/(?:www\.)?([^.]+)\./);
    const compToken = domainMatch ? domainMatch[1] : '';
    if (compToken) {
      targetUrl = `https://job-boards.greenhouse.io/${compToken}/jobs/${ghJidMatch[1]}`;
      console.log(`[Greenhouse] Normalized custom careers URL to canonical Greenhouse board: ${targetUrl}`);
    }
  }

  console.log(`[Greenhouse] Navigating to: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomSleep(1500, 2500);

  // Extract Job Title & Company if available
  let title = 'Software Role';
  let company = 'Greenhouse Job';
  try {
    const heading = await page.locator('.app-title, h1, .job-title').first().textContent();
    if (heading) title = heading.trim();
  } catch {}

  const compMatch = url.match(/greenhouse\.io\/([^/]+)/);
  if (compMatch && compMatch[1]) {
    company = compMatch[1].charAt(0).toUpperCase() + compMatch[1].slice(1);
  }

  console.log(`[Greenhouse] Role: "${title}" @ ${company}`);

  // Scroll smoothly down to the application form
  await page.evaluate(() => {
    const form = document.querySelector('#application_form, #apply_app, form');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
  });
  await randomSleep(1000, 1500);

  // 1. Core Fields: First Name, Last Name
  const firstNameSelectors = ['#first_name', 'input[name="job_application[first_name]"]', 'input[autocomplete="given-name"]'];
  for (const sel of firstNameSelectors) {
    if (await page.locator(sel).count() > 0) {
      await humanType(page, sel, profile.personal.firstName);
      break;
    }
  }

  const lastNameSelectors = ['#last_name', 'input[name="job_application[last_name]"]', 'input[autocomplete="family-name"]'];
  for (const sel of lastNameSelectors) {
    if (await page.locator(sel).count() > 0) {
      await humanType(page, sel, profile.personal.lastName);
      break;
    }
  }

  // 2. Email
  const emailSelectors = ['#email', 'input[name="job_application[email]"]', 'input[type="email"]'];
  for (const sel of emailSelectors) {
    if (await page.locator(sel).count() > 0) {
      await humanType(page, sel, profile.personal.email);
      break;
    }
  }

  // 3. Phone
  const phoneSelectors = ['#phone', 'input[name="job_application[phone]"]', 'input[type="tel"]'];
  for (const sel of phoneSelectors) {
    if (await page.locator(sel).count() > 0) {
      await humanType(page, sel, profile.personal.phone);
      break;
    }
  }

  // 4. Resume Upload
  if (profile.documents && profile.documents.resumePath && fs.existsSync(profile.documents.resumePath)) {
    console.log(`[Greenhouse] Uploading resume from: ${profile.documents.resumePath}`);
    const resumeInput = page.locator('input[type="file"][id*="resume"], input[type="file"][name*="resume"], input[type="file"]').first();
    if (await resumeInput.count() > 0) {
      const uploadPromise = page.waitForResponse(
        res => (res.url().includes('s3') || res.url().includes('attachment')) && (res.status() === 200 || res.status() === 201),
        { timeout: 15000 }
      ).catch(() => null);

      await resumeInput.setInputFiles(profile.documents.resumePath);
      const res = await uploadPromise;
      if (res) {
        console.log(`[Greenhouse] Resume S3 upload completed successfully (${res.status()}).`);
      }
      await randomSleep(1500, 2500);
    }
  } else {
    console.warn('[Greenhouse] Notice: Resume file not found or not specified.');
  }

  // 5. Links & Custom Text Inputs (LinkedIn, GitHub, Portfolio, Company, Notice Period, etc.)
  const textInputs = await page.locator('input[type="text"], input[type="url"], input[type="number"]').all();
  for (const input of textInputs) {
    const id = (await input.getAttribute('id') || '').toLowerCase();
    const name = (await input.getAttribute('name') || '').toLowerCase();
    if (id.includes('first_name') || id.includes('last_name') || id.includes('email') || id.includes('phone') ||
        name.includes('first_name') || name.includes('last_name') || name.includes('email') || name.includes('phone')) {
      continue;
    }

    if (!await input.isVisible().catch(() => false)) continue;

    const labelText = (await input.evaluate(el => {
      const parent = el.closest('div.field, .field-wrapper, label') || el.parentElement;
      return parent ? parent.innerText : '';
    })).toLowerCase();

    if (labelText.includes('linkedin') && profile.links.linkedin) {
      await input.fill(profile.links.linkedin);
    } else if (labelText.includes('github') && profile.links.github) {
      await input.fill(profile.links.github);
    } else if ((labelText.includes('portfolio') || labelText.includes('website')) && profile.links.portfolio) {
      await input.fill(profile.links.portfolio);
    } else if (labelText.includes('current company') || labelText.includes('current employer')) {
      await input.fill(profile.experience.currentCompany);
    } else if (labelText.includes('current title') || labelText.includes('current designation')) {
      await input.fill(profile.experience.currentTitle);
    } else if (labelText.includes('notice period')) {
      await input.fill(`${profile.workPreferences.noticePeriodDays} days`);
    } else if (labelText.includes('years of experience') || labelText.includes('total experience')) {
      await input.fill(profile.customAnswers.yearsOfExperience || '3');
    } else if (labelText.includes('current location') || labelText.includes('current city') || labelText.includes('location (city)') || id.includes('location') || name.includes('location')) {
      await input.fill(profile.personal.currentLocation || 'Noida, India');
    } else if (labelText.includes('prefer') || labelText.includes('preferred')) {
      await input.fill(profile.personal.firstName);
    } else if (labelText.includes('language') || labelText.includes('framework') || labelText.includes('tech stack') || labelText.includes('primary programming')) {
      await input.fill(profile.customAnswers?.primarySkills || 'Python, PySpark, SQL, Airflow');
    } else if (labelText.includes('gitlab')) {
      const ghUser = (profile.links?.github || '').split('/').filter(Boolean).pop() || '';
      await input.fill(ghUser);
    } else if (labelText.length > 5) {
      try {
        const currentVal = await input.inputValue();
        if (!currentVal) {
          const rawLabel = await input.evaluate(el => el.closest('div.field, .field-wrapper, label')?.innerText || '');
          const ans = await answerCustomQuestion(rawLabel, profile, { title, company });
          if (ans) await input.fill(ans);
        }
      } catch {}
    }
  }

  // 6. Modern React-Select dropdowns (Location, Country, Agreements, Sponsorship)
  const reactSelects = await page.locator('.select__input').all();
  for (const sInput of reactSelects) {
    const id = (await sInput.getAttribute('id') || '').toLowerCase();
    const parentText = (await sInput.evaluate(el => {
      const shell = el.closest('.select-shell') || el.closest('[class*="container"]') || el.closest('div.field');
      const parent = shell ? shell.parentElement : el.parentElement;
      return parent ? parent.innerText : '';
    })).toLowerCase();

    const selectOptionWithText = async (text) => {
      await sInput.focus();
      await sInput.fill(text);
      await page.waitForTimeout(500);
      const opt = page.locator('[class*="option"]').filter({ hasText: new RegExp(`^${text}`, 'i') }).first();
      if (await opt.isVisible().catch(() => false)) {
        await opt.click().catch(() => {});
      } else {
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      }
    };

    if (parentText.includes('country in which you will be located') || parentText.includes('country of residence') || parentText.includes('current country')) {
      await selectOptionWithText('India');
    } else if (parentText.includes('based in bangalore') || parentText.includes('describes you')) {
      await selectOptionWithText("I'm based in Bangalore");
    } else if (parentText.includes('years of full-time') || parentText.includes('professional software engineering experience')) {
      await selectOptionWithText('Less Than 5 Years');
    } else if (parentText.includes('located in india') || parentText.includes('are you located in')) {
      await selectOptionWithText('Yes');
    } else if (parentText.includes('previously worked') || parentText.includes('consulted for') || parentText.includes('former employee')) {
      await selectOptionWithText('No');
    } else if (parentText.includes('sponsorship')) {
      await selectOptionWithText('No');
    } else if (parentText.includes('source of your right to work') || parentText.includes('source of right to work') || parentText.includes('right to work where')) {
      await selectOptionWithText('Citizen');
    } else if (parentText.includes('employment agreement') || parentText.includes('restriction')) {
      await selectOptionWithText('No');
    } else if (id.includes('location') || parentText.includes('city') || (parentText.includes('location') && !parentText.includes('located in'))) {
      await selectOptionWithText('Noida');
    } else if (parentText.includes('what is your sex') || parentText.includes('biological sex')) {
      await selectOptionWithText('Male');
    } else if (id.includes('gender') || parentText.includes('gender')) {
      await selectOptionWithText('Male');
    } else if (parentText.includes('sexual orientation')) {
      await selectOptionWithText('Prefer not to say');
    } else if (parentText.includes('neurodivergent')) {
      await selectOptionWithText('No');
    } else if (id.includes('hispanic') || parentText.includes('hispanic') || parentText.includes('latino')) {
      await selectOptionWithText('No');
    } else if (id.includes('veteran') || parentText.includes('veteran')) {
      await selectOptionWithText('No');
    } else if (id.includes('disability') || parentText.includes('disability')) {
      await selectOptionWithText('No');
    } else if (parentText.includes('notice')) {
      await selectOptionWithText('30');
    }
  }

  // Safety pass for any remaining unselected react-select dropdowns
  for (const sInput of reactSelects) {
    try {
      const isPlaceholder = await sInput.evaluate(el => !!el.closest('.select-shell')?.querySelector('.select__placeholder'));
      if (isPlaceholder) {
        const parent = await sInput.evaluate(el => el.closest('.select-shell')?.parentElement?.innerText || '');
        const pLower = parent.toLowerCase();
        console.log(`[Greenhouse] Resolving unselected dropdown: "${parent.slice(0, 50)}..."`);
        const val = (pLower.includes('right to work') || pLower.includes('source of'))
          ? 'Citizen'
          : (pLower.includes('located') || pLower.includes('authorized') || pLower.includes('eligible')) 
            ? 'Yes' 
            : (pLower.includes('sex') || pLower.includes('gender') || pLower.includes('orientation')) 
              ? 'Prefer not to say' 
              : 'No';
        await sInput.focus();
        await sInput.fill(val);
        await page.waitForTimeout(500);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      }
    } catch {}
  }

  // 7. Custom Text Fields & Screening Questions
  const textareas = await page.locator('textarea').all();
  for (const ta of textareas) {
    if (!await ta.isVisible().catch(() => false)) continue;
    const name = (await ta.getAttribute('name') || '').toLowerCase();
    const id = (await ta.getAttribute('id') || '').toLowerCase();
    if (name.includes('resume') || id.includes('resume')) continue;

    const qText = await ta.evaluate(el => {
      const label = el.closest('div.field') || el.parentElement;
      return label ? label.innerText : '';
    });
    if (qText) {
      const answer = await answerCustomQuestion(qText, profile, { title, company });
      if (answer) await ta.fill(answer).catch(() => {});
    }
  }

  // 7. Standard Select Dropdowns (Authorization, Sponsorship, etc.)
  const selects = await page.locator('select').all();
  for (const sel of selects) {
    const qText = await sel.evaluate(el => {
      const label = el.closest('div.field') || el.parentElement;
      return label ? label.innerText : '';
    });

    const lowerQ = qText.toLowerCase();
    if (lowerQ.includes('authorized') || lowerQ.includes('legally')) {
      await sel.selectOption({ label: 'Yes' }).catch(() => sel.selectOption({ index: 1 }));
    } else if (lowerQ.includes('sponsorship')) {
      await sel.selectOption({ label: 'No' }).catch(() => sel.selectOption({ index: 2 }));
    } else if (lowerQ.includes('gender') || lowerQ.includes('sex')) {
      await sel.selectOption({ label: 'Male' }).catch(() => sel.selectOption({ label: 'Decline To Self Identify' })).catch(() => {});
    } else if (lowerQ.includes('veteran')) {
      await sel.selectOption({ label: 'I am not a protected veteran' }).catch(() => {});
    } else if (lowerQ.includes('disability')) {
      await sel.selectOption({ label: 'No, I do not have a disability' }).catch(() => {});
    }
  }

  // 7.5 Check all mandatory consent / terms / demographic checkboxes
  const checkboxes = await page.locator('input[type="checkbox"]').all();
  for (const cb of checkboxes) {
    if (await cb.isVisible().catch(() => false)) {
      const isChecked = await cb.isChecked().catch(() => false);
      if (!isChecked) {
        console.log('[Greenhouse] Checking required consent checkbox...');
        await cb.check({ force: true }).catch(() => cb.click({ force: true }));
      }
    }
  }

  await randomSleep(2000, 3000);

  // 8. Submit or Dry-Run
  if (dryRun) {
    console.log('[Greenhouse] [DRY RUN] Form pre-filled successfully. Skipping final submit.');
    return { success: true, title, company, dryRun: true };
  }

  console.log('[Greenhouse] Submitting application...');
  let submitButton = page.locator('#submit_app, button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit"), input[value*="Submit"]').first();
  let foundInFrame = false;

  if (await submitButton.count() === 0) {
    // Check inside any iframes (e.g. grnhse_iframe)
    for (const frame of page.frames()) {
      const frameBtn = frame.locator('#submit_app, button[type="submit"], input[type="submit"], button:has-text("Submit Application"), button:has-text("Submit")').first();
      if (await frameBtn.count() > 0) {
        submitButton = frameBtn;
        foundInFrame = true;
        break;
      }
    }
  }

  if (await submitButton.count() > 0) {
    const submitTime = Date.now();
    try {
      await submitButton.scrollIntoViewIfNeeded({ timeout: 4000 });
      await submitButton.click({ timeout: 6000 });
    } catch {
      await page.evaluate(() => {
        const btn = document.querySelector('#submit_app, button[type="submit"], input[type="submit"]');
        if (btn) btn.click();
        else document.querySelector('form')?.requestSubmit();
      }).catch(() => {});
    }

    console.log('[Greenhouse] Waiting for submission response (or security verification modal)...');
    let otpDetected = false;
    let isConfirmed = false;
    const waitDeadline = Date.now() + 25000;

    while (Date.now() < waitDeadline) {
      // 1. Check for Greenhouse 8-character verification code prompt
      const securityInput0 = page.locator('#security-input-0');
      if (await securityInput0.isVisible().catch(() => false)) {
        otpDetected = true;
        break;
      }

      // 2. Check if confirmation screen already reached
      const curBody = await page.locator('body').innerText().catch(() => '');
      const curUrl = page.url();
      if (
        curBody.includes('Thank you') ||
        curBody.includes('Application Submitted') ||
        curBody.includes('received your application') ||
        curBody.includes('Thanks for applying') ||
        curUrl.includes('thank') ||
        curUrl.includes('confirmation')
      ) {
        isConfirmed = true;
        break;
      }

      // 3. Check for obvious form errors that aborted submit
      const hasErrors = await page.locator('.field-error, .error-message, input:invalid').count().catch(() => 0);
      if (hasErrors > 0 && !curBody.includes('Submitting') && !curBody.includes('spinner')) {
        break;
      }

      await page.waitForTimeout(1500);
    }

    // Handle OTP flow if verification modal appeared
    if (otpDetected) {
      console.log('\n=============================================================');
      console.log('🔒 GREENHOUSE EMAIL VERIFICATION CODE REQUIRED');
      console.log(`Greenhouse sent an 8-character security code to: ${profile.personal.email}`);
      console.log('Automated OTP retrieval in progress from Gmail...');
      console.log('=============================================================\n');

      const appPass = process.env.GMAIL_APP_PASSWORD || profile.emailConfig?.appPassword;
      let code = options.verificationCode;
      if (!code && appPass) {
        console.log('🤖 [Auto-OTP] Checking your inbox automatically for Greenhouse verification code...');
        code = await fetchGreenhouseOtp({
          email: profile.personal.email,
          appPassword: appPass,
          timeoutMs: 50000,
          submittedAfter: submitTime - 20000
        });
        if (code) {
          console.log(`🎉 [Auto-OTP] Automatically retrieved code from email: ${code}`);
        }
      }

      if (code) {
        const cleanCode = code.trim();
        console.log(`[Greenhouse] Entering verification code (exact case): ${cleanCode}...`);
        for (let i = 0; i < 8; i++) {
          await page.locator(`#security-input-${i}`).fill(cleanCode[i]);
          await page.waitForTimeout(100);
        }
        await randomSleep(1000, 2000);

        // Click verify or submit
        const verifyBtn = page.locator('#submit_app, button[type="submit"], button:has-text("Submit"), button:has-text("Verify")').first();
        if (await verifyBtn.count() > 0) {
          await verifyBtn.click().catch(() => {});
        } else {
          await submitButton.click().catch(() => {});
        }

        // Wait up to 20 seconds for post-OTP confirmation screen
        const otpWaitDeadline = Date.now() + 20000;
        while (Date.now() < otpWaitDeadline) {
          const postBody = await page.locator('body').innerText().catch(() => '');
          const postUrl = page.url();
          if (
            postBody.includes('Thank you') ||
            postBody.includes('Application Submitted') ||
            postBody.includes('received') ||
            postUrl.includes('thank') ||
            postUrl.includes('confirmation')
          ) {
            isConfirmed = true;
            break;
          }
          await page.waitForTimeout(2000);
        }
      } else {
        return { 
          success: false, 
          needsVerificationCode: true, 
          title, 
          company, 
          email: profile.personal.email,
          reason: 'Waiting for 8-character email verification code' 
        };
      }
    }

    if (isConfirmed) {
      console.log('[Greenhouse] Application submitted successfully!');
      return { success: true, title, company, dryRun: false };
    } else {
      await page.screenshot({ path: 'last_submission_state.png' }).catch(() => {});
      console.warn('[Greenhouse] Form submitted, but final confirmation screen was not reached.');
      return { success: false, title, company, dryRun: false, reason: 'Confirmation screen not reached' };
    }
  } else {
    throw new Error('Could not locate the submit button on the application form.');
  }
}
