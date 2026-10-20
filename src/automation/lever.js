import fs from 'fs';
import { humanType, randomSleep } from './browser.js';
import { answerCustomQuestion } from '../ai/fieldMatcher.js';

export async function applyToLever(page, url, profile, options = {}) {
  const { dryRun = false } = options;
  // Ensure we are on the /apply page
  let targetUrl = url;
  if (!targetUrl.endsWith('/apply') && !targetUrl.includes('/apply?')) {
    targetUrl = targetUrl.replace(/\/$/, '') + '/apply';
  }

  console.log(`[Lever] Navigating to: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomSleep(1500, 2500);

  // Extract Title & Company
  let title = 'Software Role';
  let company = 'Lever Job';
  try {
    const heading = await page.locator('.posting-headline h2, h2, h1').first().textContent();
    if (heading) title = heading.trim();
  } catch {}

  console.log(`[Lever] Role: "${title}"`);

  // 1. Resume Upload
  if (profile.documents && profile.documents.resumePath && fs.existsSync(profile.documents.resumePath)) {
    console.log(`[Lever] Uploading resume from: ${profile.documents.resumePath}`);
    const resumeInput = page.locator('input[type="file"][id*="resume"], input[type="file"]').first();
    if (await resumeInput.count() > 0) {
      await resumeInput.setInputFiles(profile.documents.resumePath);
      await randomSleep(2000, 3500);
    }
  }

  // 2. Full Name
  const fullName = `${profile.personal.firstName} ${profile.personal.lastName}`.trim();
  if (await page.locator('input[name="name"]').count() > 0) {
    await humanType(page, 'input[name="name"]', fullName);
  }

  // 3. Email
  if (await page.locator('input[name="email"]').count() > 0) {
    await humanType(page, 'input[name="email"]', profile.personal.email);
  }

  // 4. Phone
  if (await page.locator('input[name="phone"]').count() > 0) {
    await humanType(page, 'input[name="phone"]', profile.personal.phone);
  }

  // 5. Current Company / Org
  if (await page.locator('input[name="org"]').count() > 0) {
    await humanType(page, 'input[name="org"]', profile.customAnswers.currentCompany || 'Self-Employed / Independent');
  }

  // 6. Links (LinkedIn, GitHub, Portfolio)
  if (profile.links.linkedin && await page.locator('input[name="urls[LinkedIn]"]').count() > 0) {
    await page.locator('input[name="urls[LinkedIn]"]').fill(profile.links.linkedin);
  }
  if (profile.links.github && await page.locator('input[name="urls[GitHub]"]').count() > 0) {
    await page.locator('input[name="urls[GitHub]"]').fill(profile.links.github);
  }
  if (profile.links.portfolio && await page.locator('input[name="urls[Portfolio]"]').count() > 0) {
    await page.locator('input[name="urls[Portfolio]"]').fill(profile.links.portfolio);
  }

  // 7. Custom Questions / Textareas
  const textareas = await page.locator('textarea').all();
  for (const ta of textareas) {
    const qText = await ta.evaluate(el => {
      const parent = el.closest('.application-question, .custom-question') || el.parentElement;
      return parent ? parent.innerText : '';
    });
    if (qText) {
      const answer = await answerCustomQuestion(qText, profile, { title, company });
      await ta.fill(answer);
    }
  }

  await randomSleep(2000, 3000);

  // 8. Submit or Dry-Run
  if (dryRun) {
    console.log('[Lever] [DRY RUN] Form pre-filled successfully. Skipping final submit.');
    return { success: true, title, company, dryRun: true };
  }

  console.log('[Lever] Submitting application...');
  const submitBtn = page.locator('button#btn-submit, button[type="submit"], .postings-btn').first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
    await randomSleep(4000, 6000);
    console.log('[Lever] Application submitted successfully!');
    return { success: true, title, company, dryRun: false };
  } else {
    throw new Error('Could not locate Lever submit button.');
  }
}
