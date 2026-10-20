import { createBrowser, randomSleep } from '../automation/browser.js';
import { resolveCompanyATS } from './careerSiteResolver.js';
import { loadProfile } from '../config.js';

/**
 * Searches Glassdoor India for jobs matching target role queries.
 * Extracts listings and checks for underlying company ATS portals.
 */
export async function searchGlassdoorJobs(options = {}) {
  let defaultQuery = 'Data Engineer';
  try {
    const prof = loadProfile();
    if (prof.workPreferences?.targetRoles?.length > 0) defaultQuery = prof.workPreferences.targetRoles[0];
  } catch {}

  const {
    query = defaultQuery,
    location = 'India',
    maxResults = 25,
    resolveATS = true,
    headless = true
  } = options;

  console.log(`\n🔍 [Glassdoor Scraper] Starting search for "${query}" in "${location}"...`);

  const { browser, page } = await createBrowser({ headless });
  const results = [];

  try {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${encodedQuery}&locT=N&locId=115&locKeyword=${encodeURIComponent(location)}`;

    console.log(`[Glassdoor] Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(2500, 4000);

    // Check if verification page appeared
    const pageText = await page.locator('body').innerText();
    if (pageText.includes('Verify you are human') || pageText.includes('Attention Required')) {
      console.warn('⚠️ [Glassdoor] Bot challenge detected. Attempting fallback direct search URL...');
      const slugQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const directUrl = `https://www.glassdoor.co.in/Job/india-${slugQuery}-jobs-SRCH_IL.0,5_IN115_KO6,${6 + slugQuery.length}.htm`;
      await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await randomSleep(2000, 3000);
    }

    // Scroll to trigger lazy loading of cards
    for (let scroll = 0; scroll < 3; scroll++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await randomSleep(800, 1200);
    }

    // Extract job cards from page
    const rawJobs = await page.evaluate((max) => {
      const cards = Array.from(document.querySelectorAll('[data-test="job-card"], [class*="JobCard_jobCard"], [data-test="jobListing"]'));
      const seen = new Set();
      const extracted = [];

      for (const card of cards) {
        if (extracted.length >= max) break;

        const titleEl = card.querySelector('[data-test="job-title"], a[class*="JobTitle"], [class*="jobTitle"]');
        const compEl = card.querySelector('[data-test="emp-name"], [class*="EmployerName"], [class*="employerName"]');
        const locEl = card.querySelector('[data-test="emp-location"], [class*="JobCard_location"]');
        const linkEl = card.querySelector('a[href*="/job-listing/"], a[href*="/partner/jobListing"]');
        const salaryEl = card.querySelector('[data-test="detailSalary"], [class*="JobCard_salary"]');

        const title = titleEl ? titleEl.innerText.trim() : '';
        const companyRaw = compEl ? compEl.innerText.trim() : '';
        const company = companyRaw.replace(/\n.*$/g, '').replace(/\s*\d+(\.\d+)?\s*★?$/, '').trim();
        const loc = locEl ? locEl.innerText.trim() : 'India';
        const url = linkEl ? linkEl.href : '';
        const salary = salaryEl ? salaryEl.innerText.trim() : '';
        const isEasyApply = card.innerText.includes('Easy Apply');

        const key = `${company.toLowerCase()}_${title.toLowerCase()}`;
        if (title && company && !seen.has(key)) {
          seen.add(key);
          extracted.push({
            title,
            company,
            location: loc,
            glassdoorUrl: url,
            salary,
            isEasyApply,
            source: 'Glassdoor'
          });
        }
      }
      return extracted;
    }, maxResults);

    console.log(`[Glassdoor] Found ${rawJobs.length} raw listings.`);

    // If resolveATS is enabled, look up official ATS career links
    for (const job of rawJobs) {
      if (resolveATS) {
        const atsInfo = await resolveCompanyATS(job.company);
        job.ats = atsInfo.ats;
        job.careerUrl = atsInfo.boardUrl;
        job.matchingAtsRoles = atsInfo.matchingRoles;
      }
      results.push(job);
    }

  } catch (err) {
    console.error('❌ [Glassdoor Scraper Error]:', err.message);
  } finally {
    await browser.close();
  }

  return results;
}
