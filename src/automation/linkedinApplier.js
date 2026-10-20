import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBrowser, randomSleep } from './browser.js';
import { loadProfile, isCompanyExcluded } from '../config.js';
import { isAlreadyApplied, isRoleAlreadyApplied, recordApplication } from '../tracker.js';
import { isExperienceMatching } from '../scrapers/jobFinder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LINKEDIN_STORAGE = path.resolve(__dirname, '../../data/linkedin_storage_state.json');

/**
 * Searches and automatically applies to Data Engineer Easy-Apply roles on LinkedIn (2-5 YOE)
 */
export async function applyToLinkedInJobs(options = {}) {
  const {
    maxApplications = 5,
    headless = true,
    query = 'Data Engineer',
    location = 'India',
    minExp = 2,
    maxExp = 5
  } = options;

  console.log(`\n============================================================`);
  console.log(`🛡️ [LINKEDIN POLICY SHIELD] On-Platform Easy Apply Disabled`);
  console.log(`Policy: Never apply on LinkedIn. Only scrape jobs & apply outside via external URLs or emails.`);
  console.log(`============================================================`);

  return {
    appliedCount: 0,
    applications: [],
    skippedPolicy: true,
    message: 'On-platform LinkedIn apply is disabled per your safety policy. Using LinkedIn only to scrape jobs & recruiter emails.'
  };

  const profile = loadProfile();
  const phone = profile.personal?.phone || '9220299305';
  const resumePath = (profile?.documents?.resumePath && fs.existsSync(profile.documents.resumePath))
    ? profile.documents.resumePath
    : path.resolve(__dirname, '../../data/Prakash-Kumar-Yadav-Resume.pdf');


  const { browser, page } = await createBrowser({
    headless,
    channel: 'chrome',
    storageState: LINKEDIN_STORAGE
  });

  const applications = [];

  try {
    const encodedQuery = encodeURIComponent(query);
    const encodedLoc = encodeURIComponent(location);
    // f_AL=true (Easy Apply), f_TPR=r86400 (Past 24h), f_E=2,3 (Entry & Mid-Senior / Associate)
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodedQuery}&location=${encodedLoc}&f_AL=true&f_TPR=r86400&sortBy=DD`;

    console.log(`[LinkedIn] Navigating to search: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(2500, 3500);

    // Check if authwall or login redirect occurred
    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      console.warn('⚠️ [LinkedIn] Session expired or requires login verification.');
      return { appliedCount: 0, applications: [], sessionExpired: true };
    }

    // Scroll down job list container
    for (let s = 0; s < 4; s++) {
      await page.evaluate(() => {
        const jobList = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
        if (jobList) jobList.scrollBy(0, 800);
        else window.scrollBy(0, 800);
      });
      await randomSleep(500, 800);
    }

    const jobCards = await page.locator('.jobs-search-results__list-item, [data-occludable-job-id], .job-card-container').all();
    console.log(`[LinkedIn] Discovered ${jobCards.length} potential Easy Apply job cards.`);

    const candidates = [];
    const seenUrls = new Set();

    for (const card of jobCards) {
      const title = (await card.locator('.job-card-list__title, .artdeco-entity-lockup__title, a[href*="/jobs/view/"]').first().innerText().catch(() => '')).trim();
      const company = (await card.locator('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle').first().innerText().catch(() => '')).trim();
      const linkEl = card.locator('a[href*="/jobs/view/"]').first();
      const rawUrl = (await linkEl.getAttribute('href').catch(() => '')) || '';

      if (title && company && rawUrl) {
        const cleanUrl = rawUrl.split('?')[0];
        if (seenUrls.has(cleanUrl)) continue;
        seenUrls.add(cleanUrl);

        if (!isExperienceMatching(title, minExp, maxExp)) continue;
        if (isCompanyExcluded(company, cleanUrl)) continue;
        if (isAlreadyApplied(cleanUrl) || isRoleAlreadyApplied(company, title)) continue;

        candidates.push({ title, company, url: cleanUrl });
      }
    }

    console.log(`🎯 [LinkedIn] Found ${candidates.length} eligible unapplied candidates.`);

    for (let i = 0; i < candidates.length && applications.length < maxApplications; i++) {
      const job = candidates[i];
      console.log(`\n------------------------------------------------------------`);
      console.log(`[LinkedIn Apply ${applications.length + 1}/${maxApplications}] "${job.title}" @ ${job.company}`);
      console.log(`URL: ${job.url}`);

      try {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomSleep(2000, 3000);

        // Click Easy Apply button
        const easyApplyBtn = page.locator('button.jobs-apply-button, button:has-text("Easy Apply")').first();
        if (!(await easyApplyBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
          console.log(`⏭️ Easy Apply button not visible (may already be applied or standard apply). Skipping.`);
          continue;
        }

        await easyApplyBtn.click();
        await randomSleep(1500, 2500);

        // Wizard navigation loop (up to 5 steps)
        let submitted = false;
        for (let step = 0; step < 5; step++) {
          const modal = page.locator('.jobs-easy-apply-modal, [data-test-modal]').first();
          if (!(await modal.isVisible({ timeout: 2000 }).catch(() => false))) {
            break;
          }

          // Fill any text inputs
          const textInputs = await modal.locator('input[type="text"], input[type="tel"], textarea').all();
          for (const inp of textInputs) {
            const val = await inp.inputValue().catch(() => '');
            if (!val) {
              const label = (await inp.getAttribute('aria-label').catch(() => '')) || '';
              if (/phone|mobile/i.test(label)) await inp.fill(phone);
              else if (/experience|years/i.test(label)) await inp.fill('2.8');
              else if (/notice/i.test(label)) await inp.fill('15');
              else if (/salary|ctc/i.test(label)) await inp.fill('12');
              else await inp.fill('2.8');
            }
          }

          // Check if Submit application button is visible
          const submitBtn = modal.locator('button[aria-label="Submit application"], button:has-text("Submit application")').first();
          if (await submitBtn.isVisible().catch(() => false)) {
            console.log(`🚀 Clicking "Submit application" on LinkedIn...`);
            await submitBtn.click();
            await randomSleep(2500, 3500);
            submitted = true;
            break;
          }

          // Check Next / Review button
          const nextBtn = modal.locator('button[aria-label="Continue to next step"], button:has-text("Next"), button:has-text("Review")').first();
          if (await nextBtn.isVisible().catch(() => false)) {
            await nextBtn.click();
            await randomSleep(1500, 2500);
          } else {
            break;
          }
        }

        // Close any post-apply confirmation dialog
        const dismissBtn = page.locator('button[aria-label="Dismiss"], button:has-text("Done")').first();
        if (await dismissBtn.isVisible().catch(() => false)) {
          await dismissBtn.click().catch(() => {});
        }

        if (submitted) {
          console.log(`✅ [LinkedIn Applied Successfully] "${job.title}" @ ${job.company}!`);
          recordApplication({
            company: job.company,
            title: job.title,
            url: job.url,
            platform: 'LINKEDIN',
            status: 'SUBMITTED',
            notes: 'LinkedIn Easy Apply'
          });
          applications.push({
            company: job.company,
            title: job.title,
            url: job.url,
            status: 'SUBMITTED'
          });
        }

        await randomSleep(6000, 9000);
      } catch (err) {
        console.warn(`❌ Error applying on LinkedIn to ${job.company}: ${err.message}`);
      }
    }

    console.log(`\n🎉 [LinkedIn Complete] Successfully submitted ${applications.length} applications!`);
  } catch (err) {
    console.error(`[LinkedIn Auto-Apply Error]: ${err.message}`);
  } finally {
    await browser.close().catch(() => {});
  }

  return { appliedCount: applications.length, applications };
}
