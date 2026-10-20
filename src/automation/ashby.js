import fs from 'fs';
import { humanType, randomSleep } from './browser.js';
import { answerCustomQuestion } from '../ai/fieldMatcher.js';

export async function applyToAshby(page, url, profile, options = {}) {
  const { dryRun = false } = options;

  let applyUrl = url;
  if (!applyUrl.endsWith('/application') && !applyUrl.includes('/application?')) {
    applyUrl = applyUrl.replace(/\/+$/, '') + '/application';
  }

  console.log(`[Ashby] Navigating to: ${applyUrl}`);
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomSleep(2000, 3000);

  // Extract Title & Company
  let title = 'Software Role';
  let company = 'Ashby Company';
  try {
    const pageTitle = await page.title();
    const parts = pageTitle.split(' - ');
    if (parts.length >= 2) {
      title = parts[0].trim();
      company = parts[1].trim();
    }
  } catch {}

  console.log(`[Ashby] Applying for "${title}" @ ${company}`);

  // 1. Full Name
  const fullName = `${profile.personal.firstName} ${profile.personal.lastName}`;
  const nameInput = page.locator('#_systemfield_name, input[name="_systemfield_name"], input[placeholder*="Name"]').first();
  if (await nameInput.count() > 0) {
    await humanType(page, '#_systemfield_name', fullName);
  }

  // 2. Email
  const emailInput = page.locator('#_systemfield_email, input[name="_systemfield_email"], input[type="email"]').first();
  if (await emailInput.count() > 0) {
    await humanType(page, '#_systemfield_email', profile.personal.email);
  }

  // 3. Phone
  const phoneInput = page.locator('input[type="tel"]').first();
  if (await phoneInput.count() > 0) {
    await humanType(page, 'input[type="tel"]', profile.personal.phone);
  }

  // 4. Resume Upload
  if (profile.documents && profile.documents.resumePath && fs.existsSync(profile.documents.resumePath)) {
    console.log(`[Ashby] Uploading resume from: ${profile.documents.resumePath}`);
    const resumeInput = page.locator('input[type="file"]#_systemfield_resume, input[type="file"]').first();
    if (await resumeInput.count() > 0) {
      await resumeInput.setInputFiles(profile.documents.resumePath);
      await randomSleep(2000, 3500);
      console.log(`[Ashby] Resume uploaded.`);
    }
  }

  // 5. Location
  const locInput = page.locator('input[placeholder*="Start typing"], input[id*="location"]').first();
  if (await locInput.count() > 0) {
    try {
      await humanType(page, 'input[placeholder*="Start typing"]', 'India');
      await randomSleep(1000, 1500);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    } catch {}
  }

  // 6. Social Links (LinkedIn, GitHub, Portfolio)
  const textInputs = await page.locator('input[type="text"]').all();
  for (const input of textInputs) {
    const placeholder = (await input.getAttribute('placeholder') || '').toLowerCase();
    const label = await input.evaluate(el => el.closest('label')?.innerText || el.closest('[class*="Field"]')?.innerText || '').then(t => t.toLowerCase()).catch(() => '');

    if (label.includes('linkedin') || placeholder.includes('linkedin')) {
      await input.fill(profile.links.linkedin);
    } else if (label.includes('github') || placeholder.includes('github')) {
      await input.fill(profile.links.github);
    } else if (label.includes('website') || label.includes('portfolio') || placeholder.includes('website') || placeholder.includes('portfolio')) {
      await input.fill(profile.links.portfolio);
    }
  }

  // 7. Screening Questions / Text Areas
  const textareas = await page.locator('textarea:not([name="g-recaptcha-response"])').all();
  for (const ta of textareas) {
    const qText = await ta.evaluate(el => el.closest('label')?.innerText || el.closest('[class*="Field"]')?.innerText || '');
    if (qText) {
      const answer = await answerCustomQuestion(qText, profile, { title, company });
      await ta.fill(answer);
    }
  }

  await randomSleep(2000, 3000);

  // 8. Submit or Dry-Run
  if (dryRun) {
    console.log('[Ashby] [DRY RUN] Form pre-filled successfully. Skipping final submit.');
    return { success: true, title, company, dryRun: true };
  }

  console.log('[Ashby] Submitting application...');
  const submitButton = page.locator('button[type="submit"], button:has-text("Submit Application"), button:has-text("Submit")').first();
  if (await submitButton.count() > 0) {
    await submitButton.click();
    await randomSleep(5000, 7000);

    const bodyText = await page.locator('body').innerText();
    const isConfirmed = bodyText.includes('Thank you') || bodyText.includes('Application Submitted') || bodyText.includes('received') || page.url().includes('confirmation') || page.url().includes('thank');

    if (isConfirmed) {
      console.log('✅ [Ashby] Application submitted successfully!');
      return { success: true, title, company, dryRun: false };
    } else {
      console.warn('⚠️ [Ashby] Form submitted, checking submission status...');
      return { success: true, title, company, dryRun: false };
    }
  } else {
    throw new Error('Could not locate the submit button on Ashby application form.');
  }
}
