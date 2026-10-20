import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBrowser, randomSleep } from '../automation/browser.js';
import { isCompanyExcluded, loadProfile } from '../config.js';
import { resolveCompanyATS } from './careerSiteResolver.js';
import { isAlreadyApplied, isRoleAlreadyApplied } from '../tracker.js';
import { isExperienceMatching } from './jobFinder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORTAL_JOBS_FILE = path.resolve(__dirname, '../../data/portal_jobs.json');
const INDIA_COMPANIES_PATH = path.resolve(__dirname, '../../config/india_companies.json');

export function getSavedPortalJobs() {
  if (fs.existsSync(PORTAL_JOBS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PORTAL_JOBS_FILE, 'utf-8'));
    } catch {}
  }
  return [];
}

export function savePortalJobs(jobs) {
  const dir = path.dirname(PORTAL_JOBS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PORTAL_JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
}

/**
 * Dynamically registers newly discovered company ATS boards into config/india_companies.json
 */
export function registerDiscoveredCompany(companyName, token, ats) {
  try {
    const raw = fs.readFileSync(INDIA_COMPANIES_PATH, 'utf-8');
    const list = JSON.parse(raw);
    const cleanToken = token.toLowerCase().trim();
    const existing = list.find(c => c.token?.toLowerCase() === cleanToken && c.ats === ats);
    if (!existing) {
      list.push({ name: companyName, token: cleanToken, ats });
      fs.writeFileSync(INDIA_COMPANIES_PATH, JSON.stringify(list, null, 2), 'utf-8');
      console.log(`✨ [New Company Registered]: ${companyName} (${ats}) added to india_companies.json`);
    }
  } catch (err) {
    console.warn(`[Warning] Could not register company ${companyName}:`, err.message);
  }
}

export function getDefaultSearchQuery() {
  try {
    const prof = loadProfile();
    if (prof.workPreferences?.targetRoles?.length > 0) {
      return prof.workPreferences.targetRoles[0];
    }
  } catch {}
  return 'Data Engineer';
}

/**
 * Scrapes latest uploaded jobs from LinkedIn (last 24 hours, zero login)
 */
export async function scrapeLinkedInJobs(page, query = getDefaultSearchQuery(), location = 'India') {
  console.log(`\n🔗 [LinkedIn Public Feed] Searching: "${query}" in "${location}" (Past 24h)...`);
  const jobs = [];
  const searchUrl = `https://www.linkedin.com/jobs/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&f_TPR=r86400&position=1&pageNum=0`;

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000);

    for (let s = 0; s < 2; s++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await randomSleep(500, 800);
    }

    const cards = await page.locator('.jobs-search__results-list li, .base-card').all();
    console.log(`   Discovered ${cards.length} LinkedIn postings.`);

    for (const card of cards.slice(0, 30)) {
      const title = (await card.locator('.base-search-card__title, h3').innerText().catch(() => '')).trim();
      const company = (await card.locator('.base-search-card__subtitle, h4').innerText().catch(() => '')).trim();
      const loc = (await card.locator('.job-search-card__location').innerText().catch(() => '')).trim();
      const link = await card.locator('a.base-card__full-link').getAttribute('href').catch(() => '');
      const cleanUrl = link ? link.split('?')[0] : '';

      if (title && company && cleanUrl) {
        if (!isExperienceMatching(title, 2, 5)) {
          continue;
        }
        jobs.push({
          source: 'LinkedIn',
          title,
          company,
          location: loc || 'India',
          portalUrl: cleanUrl,
          postedAt: 'Past 24 hours'
        });
      }
    }
  } catch (err) {
    console.warn(`   [LinkedIn Warning]: ${err.message}`);
  }

  return jobs;
}

/**
 * Scrapes latest uploaded jobs from Indeed India (fromage=1, past 24 hours)
 */
export async function scrapeIndeedJobs(page, query = getDefaultSearchQuery(), location = 'India') {
  console.log(`\n💼 [Indeed India Feed] Searching: "${query}" in "${location}" (Past 24h)...`);
  const jobs = [];
  const indeedUrl = `https://in.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}&fromage=1`;

  try {
    await page.goto(indeedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);

    const cards = await page.locator('.job_seen_beacon').all();
    console.log(`   Discovered ${cards.length} Indeed India postings.`);

    for (const card of cards.slice(0, 25)) {
      const title = (await card.locator('.jobTitle').innerText().catch(() => '')).trim();
      const company = (await card.locator('[data-testid="company-name"]').innerText().catch(() => '')).trim();
      const loc = (await card.locator('[data-testid="text-location"]').innerText().catch(() => '')).trim();
      const link = await card.locator('.jobTitle a').getAttribute('href').catch(() => '');
      const fullUrl = link ? (link.startsWith('http') ? link : `https://in.indeed.com${link}`) : '';

      if (title && company && fullUrl) {
        if (!isExperienceMatching(title, 2, 5)) {
          continue;
        }
        jobs.push({
          source: 'Indeed',
          title,
          company,
          location: loc || 'India',
          portalUrl: fullUrl,
          postedAt: 'Past 24 hours'
        });
      }
    }
  } catch (err) {
    console.warn(`   [Indeed Warning]: ${err.message}`);
  }

  return jobs;
}

/**
 * Master Portal Fetcher & Flow Resolver:
 * 1. Scrapes fresh postings from LinkedIn & Indeed (< 24h)
 * 2. Resolves company ATS portals (Greenhouse, Lever, Ashby)
 * 3. Registers new companies & returns actionable jobs ready for our auto-pilot flow
 */
export async function fetchAndResolvePortalJobs(options = {}) {
  const {
    query = getDefaultSearchQuery(),
    location = 'India',
    headless = true
  } = options;

  console.log(`\n============================================================`);
  console.log(`🌐 [PORTAL HARVESTER] Fetching latest jobs from Indeed & LinkedIn`);
  console.log(`Keywords: "${query}" | Location: "${location}" | Target Age: < 24 Hours`);
  console.log(`============================================================`);

  const { browser, page } = await createBrowser({ headless });
  const rawPortalJobs = [];

  try {
    const linkedinJobs = await scrapeLinkedInJobs(page, query, location);
    rawPortalJobs.push(...linkedinJobs);

    const indeedJobs = await scrapeIndeedJobs(page, query, location);
    rawPortalJobs.push(...indeedJobs);
  } finally {
    await browser.close();
  }

  console.log(`\n📦 Total Raw Postings Harvested: ${rawPortalJobs.length}`);

  const existingPortalJobs = getSavedPortalJobs();
  const seenUrls = new Set(existingPortalJobs.map(j => j.portalUrl));
  const resolvedAtsJobs = [];

  const chunkSize = 10;
  for (let i = 0; i < rawPortalJobs.length; i += chunkSize) {
    const chunk = rawPortalJobs.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (job) => {
      if (!job.company || isCompanyExcluded(job.company, job.portalUrl)) return;
      if (isAlreadyApplied(job.portalUrl) || isRoleAlreadyApplied(job.company, job.title)) return;

      if (!seenUrls.has(job.portalUrl)) {
        seenUrls.add(job.portalUrl);
        existingPortalJobs.push(job);
      }

      // Resolve employer to our automation flow (Greenhouse, Lever, Ashby)
      try {
        const resolved = await resolveCompanyATS(job.company);
        if (resolved && resolved.ats !== 'Unknown' && resolved.token) {
          registerDiscoveredCompany(job.company, resolved.token, resolved.ats.toLowerCase());

          // Check if there's a matching role on their ATS board
          if (Array.isArray(resolved.matchingRoles) && resolved.matchingRoles.length > 0) {
            for (const role of resolved.matchingRoles) {
              if (!isAlreadyApplied(role.url) && !isRoleAlreadyApplied(job.company, role.title)) {
                resolvedAtsJobs.push({
                  companyName: job.company,
                  title: role.title,
                  url: role.url,
                  platform: resolved.ats.toLowerCase(),
                  location: role.location || job.location,
                  source: `${job.source} ➡️ ${resolved.ats}`,
                  ageHours: 1.0
                });
              }
            }
          }
        }
      } catch {}
    }));
  }

  savePortalJobs(existingPortalJobs);
  console.log(`🎯 Successfully resolved ${resolvedAtsJobs.length} direct ATS roles from harvested portal listings.`);
  return resolvedAtsJobs;
}
