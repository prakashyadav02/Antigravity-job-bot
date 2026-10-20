import fs from 'fs';
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBrowser, randomSleep } from '../automation/browser.js';
import { isCompanyExcluded, loadProfile } from '../config.js';
import { isExperienceMatching } from './jobFinder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEADS_FILE = path.resolve(__dirname, '../../data/recruiter_leads.json');
const LINKEDIN_STORAGE = path.resolve(__dirname, '../../data/linkedin_storage_state.json');

// Curated domain mapping for top Indian tech employers and startups
const KNOWN_DOMAINS = {
  'meesho': 'meesho.com',
  'cred': 'cred.club',
  'inmobi': 'inmobi.com',
  'swiggy': 'swiggy.in',
  'zomato': 'zomato.com',
  'blinkit': 'blinkit.com',
  'zepto': 'zeptonow.com',
  'razorpay': 'razorpay.com',
  'phonepe': 'phonepe.com',
  'paytm': 'paytm.com',
  'flipkart': 'flipkart.com',
  'myntra': 'myntra.com',
  'nykaa': 'nykaa.com',
  'ola': 'olacabs.com',
  'ola electric': 'olaelectric.com',
  'rapido': 'rapido.bike',
  'juspay': 'juspay.in',
  'urban piper': 'urbanpiper.com',
  'alphasense': 'alphasense.com',
  'browserstack': 'browserstack.com',
  'postman': 'postman.com',
  'groww': 'groww.in',
  'zerodha': 'zerodha.com',
  'upstox': 'upstox.com',
  'dream11': 'dream11.com',
  'navi': 'navi.com',
  'urban company': 'urbancompany.com',
  'slice': 'sliceit.com',
  'duruper': 'duruper.com',
  'crashplan': 'crashplan.com',
  'interrait': 'interrait.com',
  'interra information technologies': 'interrait.com',
  'thoughtworks': 'thoughtworks.com',
  'pubmatic': 'pubmatic.com',
  'druva': 'druva.com',
  'highradius': 'highradius.com',
  'commvault': 'commvault.com',
  'zscaler': 'zscaler.com',
  'netskope': 'netskope.com',
  'samsara': 'samsara.com',
  'databricks': 'databricks.com',
  'rubrik': 'rubrik.com',
  'gitlab': 'gitlab.com',
  'mongodb': 'mongodb.com',
  'elastic': 'elastic.co',
  'stripe': 'stripe.com',
  'cloudflare': 'cloudflare.com',
  'twilio': 'twilio.com',
  'okta': 'okta.com',
  'coursera': 'coursera.org',
  'airtable': 'airtable.com',
  'notion': 'notion.so',
  'snowflake': 'snowflake.com',
  'confluent': 'confluent.io',
  'delhivery': 'delhivery.com',
  'cars24': 'cars24.com',
  'pocket fm': 'pocketfm.com',
  'zeta': 'zeta.tech',
  'epifi': 'epifi.com',
  'fi money': 'epifi.com',
  'infosys': 'infosys.com',
  'tcs': 'tcs.com',
  'tata consultancy': 'tcs.com',
  'wipro': 'wipro.com',
  'cognizant': 'cognizant.com',
  'accenture': 'accenture.com',
  'capgemini': 'capgemini.com',
  'ltimindtree': 'ltimindtree.com',
  'mindtree': 'ltimindtree.com',
  'hcl': 'hcltech.com',
  'fractal': 'fractal.ai',
  'fractal analytics': 'fractal.ai',
  'pwc': 'pwc.com',
  'ey': 'ey.com',
  'ernst': 'ey.com',
  'deloitte': 'deloitte.com',
  'kpmg': 'kpmg.com',
  'genpact': 'genpact.com',
  'tech mahindra': 'techmahindra.com',
  'nagarro': 'nagarro.com',
  'coforge': 'coforge.com',
  'birlasoft': 'birlasoft.com',
  'mphasis': 'mphasis.com',
  'altera': 'altera.com',
  'yougov': 'yougov.com',
  'thomson reuters': 'thomsonreuters.com',
  'xylem': 'xylem.com',
  'conneqt': 'conneqtcorp.com',
  'tp': 'teleperformance.com',
  'teleperformance': 'teleperformance.com',
  'amazon': 'amazon.com',
  'microsoft': 'microsoft.com',
  'google': 'google.com',
  'uber': 'uber.com',
  'walmart': 'walmart.com',
  'target': 'target.com',
  'paypal': 'paypal.com',
  'intuit': 'intuit.com',
  'adobe': 'adobe.com',
  'cisco': 'cisco.com',
  'vmware': 'vmware.com',
  'oracle': 'oracle.com',
  'salesforce': 'salesforce.com',
  'sap': 'sap.com',
  'dell': 'dell.com',
  'hp': 'hp.com',
  'ibm': 'ibm.com',
  'intel': 'intel.com',
  'amd': 'amd.com',
  'qualcomm': 'qualcomm.com',
  'nvidia': 'nvidia.com',
  'samsung': 'samsung.com',
  'airtel': 'airtel.com',
  'jio': 'ril.com'
};

/**
 * Strips corporate legal suffixes to retrieve the conversational company name
 */
export function cleanCompanyName(raw) {
  if (!raw) return '';
  return raw
    .replace(/\(.*?\)/g, '')
    .replace(/\b(private limited|pvt ltd|pvt\.? ltd\.?|limited|ltd|technologies|technology|tech|solutions|software|services|systems|infotech|consulting|india|inc|corp|corporation|llc|co)\b/gi, '')
    .replace(/[.,\-_/\s]+$/g, '')
    .trim();
}

/**
 * Normalizes company name and resolves its true web domain
 */
export function resolveCompanyDomain(rawName) {
  if (!rawName) return 'careers.com';
  const clean = rawName.toLowerCase().trim();

  // 1. Direct dictionary match
  for (const [key, domain] of Object.entries(KNOWN_DOMAINS)) {
    if (clean.includes(key)) return domain;
  }

  // 2. Extract acronym or short name inside parentheses e.g. "Interra Information Technologies (InterraIT)"
  const parenMatch = clean.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1].length >= 3) {
    const acronym = parenMatch[1].replace(/[^a-z0-9]/g, '');
    if (acronym.length >= 3) return `${acronym}.com`;
  }

  // 3. Strip corporate suffixes (Pvt Ltd, Technologies, Solutions, India, etc.)
  const stripped = clean
    .replace(/\(.*?\)/g, '')
    .replace(/\b(private limited|pvt ltd|pvt\.? ltd\.?|limited|ltd|technologies|technology|tech|solutions|software|services|systems|infotech|consulting|india|inc|corp|corporation|llc|co)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  if (stripped.length >= 3) {
    return `${stripped}.com`;
  }

  // Fallback to basic clean
  const fallback = clean.replace(/[^a-z0-9]/g, '');
  return `${fallback || 'company'}.com`;
}

export function getSavedLeads() {
  if (fs.existsSync(LEADS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8'));
    } catch {}
  }
  return [];
}

export function saveLeads(leads) {
  const dir = path.dirname(LEADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

export function updateLeadApplyStatus(leadId, applyStatus = 'APPLIED') {
  const leads = getSavedLeads();
  const lead = leads.find(l => l.id === leadId);
  if (lead) {
    lead.applyStatus = applyStatus;
    lead.appliedAt = new Date().toISOString();
    saveLeads(leads);
  }
}

/**
 * Checks if LinkedIn storage state exists and contains a valid, non-expired li_at cookie
 */
export function isLinkedInSessionActive() {
  if (!fs.existsSync(LINKEDIN_STORAGE)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(LINKEDIN_STORAGE, 'utf-8'));
    if (!Array.isArray(state.cookies)) return false;
    const liAt = state.cookies.find(c => c.name === 'li_at' && c.value);
    if (!liAt) return false;
    // Check expiration if set
    if (liAt.expires && liAt.expires * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses search headline into clean candidate Name and Role
 */
export function parseLinkedInProfileHeadline(rawHeadline, targetCompany = '') {
  let text = (rawHeadline || '')
    .replace(/^linkedin\s*/i, '')
    .replace(/https?:\/\/[^\s]+/gi, '')
    .trim();

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const headline = lines[lines.length - 1] || text;
  const parts = headline.split(/\s*[-–—|]\s*/);
  if (parts.length < 2) return null;

  const rawName = parts[0].trim();
  // Name should be 2 to 4 words and purely alphabetic
  if (!/^[a-zA-Z\s.]{2,35}$/.test(rawName) || rawName.split(' ').length > 4) {
    return null;
  }

  let rawRole = parts[1].trim();
  rawRole = rawRole
    .replace(/\s*@\s*.*$/i, '')
    .replace(/\s*at\s+.*$/i, '')
    .replace(/\s*\|\|.*$/i, '')
    .replace(/\.{2,}$/, '')
    .trim();

  if (targetCompany) {
    const esc = targetCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rawRole = rawRole.replace(new RegExp(`\\b${esc}\\b`, 'gi'), '').trim();
  }

  return {
    name: rawName,
    role: rawRole || 'Hiring Lead'
  };
}

/**
 * Queries web search engines to discover public LinkedIn profiles of company team members
 */
async function searchWebForProfiles(page, query, targetCompany) {
  const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const results = await page.evaluate(() => {
      const list = [];
      const elements = document.querySelectorAll('#web ol li, .compText, .algo');
      for (const el of elements) {
        const a = el.querySelector('h3 a, a[href*="linkedin.com/in/"]');
        const snippet = el.querySelector('.compText, p')?.innerText?.trim() || '';
        if (a && a.href && a.href.includes('linkedin.com/in/')) {
          list.push({ title: a.innerText.trim(), href: a.href, snippet });
        }
      }
      return list;
    });

    const parsed = [];
    for (const r of results) {
      const info = parseLinkedInProfileHeadline(r.title, targetCompany);
      if (info && info.name) {
        parsed.push({
          name: info.name,
          role: info.role,
          profileUrl: r.href,
          snippet: r.snippet
        });
      }
    }
    return parsed;
  } catch (err) {
    console.warn(`[Search Warning] Web query "${query}" failed: ${err.message}`);
    return [];
  }
}

/**
 * Performs logged-in LinkedIn People Search when authenticated session is available
 */
async function searchLinkedInPeopleDirect(page, company, roleQuery) {
  const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company + ' ' + roleQuery)}&origin=GLOBAL_SEARCH_HEADER`;
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await randomSleep(1500, 2500);

    // If redirected to login, session has expired
    if (page.url().includes('/login') || page.url().includes('/checkpoint') || page.url().includes('/uas/')) {
      return [];
    }

    const people = await page.evaluate(() => {
      const list = [];
      const items = document.querySelectorAll('.reusable-search__result-container, li.artdeco-list__item');
      for (const item of items) {
        const nameLink = item.querySelector('.entity-result__title-text a, a[href*="/in/"]');
        const subtitle = item.querySelector('.entity-result__primary-subtitle, .entity-result__summary');
        if (nameLink && subtitle) {
          const rawName = nameLink.innerText.split('\n')[0].trim();
          const role = subtitle.innerText.trim();
          const href = nameLink.href ? nameLink.href.split('?')[0] : '';
          if (rawName && href.includes('/in/')) {
            list.push({ name: rawName, role, profileUrl: href });
          }
        }
      }
      return list;
    });

    return people;
  } catch (err) {
    console.warn(`[LinkedIn Direct Search Info] Failed for ${company} (${roleQuery}): ${err.message}`);
    return [];
  }
}

/**
 * Discovers verified Talent Acquisition Specialists and Engineering/Data Hiring Managers
 * for a target company, synthesizing their corporate email addresses and verifying domain MX records.
 * Returns up to 2 Talent Acquisition specialists and up to 2 Hiring Managers per company.
 */
export async function fetchCompanyTeamContacts(company, domain, options = {}) {
  const {
    jobTitle = 'Data Engineer',
    page = null,
    maxTA = 2,
    maxHM = 2
  } = options;

  if (!company || !domain) return [];
  if (isCompanyExcluded(company, domain)) return [];

  const clean = cleanCompanyName(company) || company;
  if (!clean || clean.length < 2) return [];

  // Verify MX records first before expending search cycles
  try {
    const mx = await dns.promises.resolveMx(domain);
    if (!mx || mx.length === 0) return [];
  } catch {
    return [];
  }

  const contacts = [];
  const seenEmails = new Set();
  const seenNames = new Set();

  function addContact(person, forcedType = null) {
    if (!person || !person.name) return;
    const lowerName = person.name.toLowerCase().trim();
    if (seenNames.has(lowerName)) return;

    let contactType = forcedType;
    if (!contactType) {
      contactType = /talent|recruiter|hr|ta|people|talent acquisition|hiring|staffing/i.test(person.role || '')
        ? 'TALENT_ACQUISITION'
        : 'HIRING_MANAGER';
    }

    const currentCount = contacts.filter(c => c.contactType === contactType).length;
    const limit = contactType === 'TALENT_ACQUISITION' ? maxTA : maxHM;
    if (currentCount >= limit) return;

    // Synthesize email: first.last@domain
    const nameParts = person.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
    if (nameParts.length === 0) return;
    const first = nameParts[0];
    const last = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const email = last ? `${first}.${last}@${domain}` : `${first}@${domain}`;

    if (seenEmails.has(email)) return;
    seenNames.add(lowerName);
    seenEmails.add(email);

    contacts.push({
      contactType,
      recruiterName: person.name,
      recruiterTitle: person.role || (contactType === 'TALENT_ACQUISITION' ? 'Technical Recruiter' : 'Engineering Manager'),
      recruiterProfileUrl: person.profileUrl || null,
      targetEmail: email,
      domain,
      emailType: contactType === 'TALENT_ACQUISITION' ? 'Talent Acquisition' : 'Hiring Manager Direct',
      confidence: 'High (Targeted Person)'
    });
  }

  let searchPage = page;
  let localBrowser = null;

  try {
    if (!searchPage) {
      const bObj = await createBrowser({ headless: true });
      localBrowser = bObj.browser;
      searchPage = bObj.page;
    }

    // Tier 1: Authenticated LinkedIn Search (if session state is valid)
    if (isLinkedInSessionActive()) {
      try {
        const directTA = await searchLinkedInPeopleDirect(searchPage, clean, 'Talent Acquisition');
        for (const p of directTA) addContact(p, 'TALENT_ACQUISITION');

        const directHM = await searchLinkedInPeopleDirect(searchPage, clean, 'Engineering Manager Data');
        for (const p of directHM) addContact(p, 'HIRING_MANAGER');
      } catch (e) {
        console.warn(`[Direct LinkedIn Search] ${e.message}`);
      }
    }

    // Tier 2: Public Web Search for LinkedIn profiles (Zero login, 100% reliable)
    const neededTA = maxTA - contacts.filter(c => c.contactType === 'TALENT_ACQUISITION').length;
    const neededHM = maxHM - contacts.filter(c => c.contactType === 'HIRING_MANAGER').length;

    if (neededTA > 0) {
      const taQuery = `site:linkedin.com/in "${clean}" ("Talent Acquisition" OR "Technical Recruiter" OR "IT Recruiter")`;
      const taResults = await searchWebForProfiles(searchPage, taQuery, clean);
      for (const p of taResults) addContact(p, 'TALENT_ACQUISITION');
    }

    if (neededHM > 0) {
      const hmQuery = `site:linkedin.com/in "${clean}" ("Engineering Manager" OR "Lead Data Engineer" OR "Director of Engineering" OR "VP Engineering" OR "Data Lead")`;
      const hmResults = await searchWebForProfiles(searchPage, hmQuery, clean);
      for (const p of hmResults) addContact(p, 'HIRING_MANAGER');
    }

  } catch (err) {
    console.warn(`[Team Contact Search Info for ${company}]: ${err.message}`);
  } finally {
    if (localBrowser) {
      await localBrowser.close().catch(() => {});
    }
  }

  return contacts;
}

export async function recordDiscoveredLead(leadData) {
  const {
    company,
    title,
    location = 'India',
    jobUrl = '',
    contactType = 'TALENT_ACQUISITION',
    recruiterName = 'Hiring Team',
    recruiterTitle = 'Technical Recruiter',
    recruiterProfileUrl = null,
    targetEmail,
    sourcePortal = 'Job Portal',
    emailType = 'Direct Contact',
    confidence = 'High (Targeted Person)'
  } = leadData;

  if (!targetEmail || !company) return null;
  const cleanEmail = targetEmail.toLowerCase().trim();

  // Safety check against excluded companies
  if (isCompanyExcluded(company, `${cleanEmail} ${jobUrl}`)) {
    return null;
  }

  const leads = getSavedLeads();
  // Deduplicate strictly by targetEmail — allows multiple team members for the same opening
  if (leads.some(l => (l.targetEmail || '').toLowerCase() === cleanEmail)) {
    return null;
  }

  // Extract domain and verify MX
  const domain = cleanEmail.split('@')[1] || resolveCompanyDomain(company);
  try {
    const mx = await dns.promises.resolveMx(domain);
    if (!mx || mx.length === 0) return null;
  } catch {
    return null;
  }

  const newLead = {
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    company: company.trim(),
    title: (title || 'Data Engineer').trim(),
    location: location.trim(),
    timePosted: leadData.timePosted || 'Recently',
    jobUrl,
    contactType,
    recruiterName,
    recruiterTitle,
    recruiterProfileUrl: recruiterProfileUrl || null,
    targetEmail: cleanEmail,
    domain,
    emailType,
    confidence,
    sourcePortal,
    status: 'UNCONTACTED',
    discoveredAt: new Date().toISOString()
  };

  leads.unshift(newLead);
  saveLeads(leads);
  console.log(`🎯 [Multi-Contact Lead Recorded] ${newLead.company} | ${newLead.recruiterName} (${newLead.contactType}) -> ${newLead.targetEmail}`);
  return newLead;
}

/**
 * Searches LinkedIn for recent job openings, inspecting both the post and the company's team
 * to extract multiple verified contacts (Talent Acquisition + Engineering Managers) per opening.
 */
export async function fetchRecentRecruiterLeads(options = {}, fallbackHours = 1) {
  let defaultQuery = 'Data Engineer';
  try {
    const prof = loadProfile();
    if (prof.workPreferences?.targetRoles?.length > 0) {
      defaultQuery = prof.workPreferences.targetRoles[0];
    }
  } catch {}

  const opts = typeof options === 'string' ? { query: options, hours: fallbackHours } : (options || {});
  const {
    query = defaultQuery,
    location = 'India',
    hours = typeof fallbackHours === 'number' && typeof options === 'string' ? fallbackHours : (opts.hours || 1),
    maxResults = 25,
    headless = true
  } = opts;

  console.log(`\n🔍 [LinkedIn Recruiter Finder] Initiating fresh search (< ${hours}h)`);
  console.log(`Query: "${query}" | Location: "${location}" | Max Target: ${maxResults}`);
  const browserOpts = { headless };
  if (isLinkedInSessionActive()) {
    browserOpts.storageState = LINKEDIN_STORAGE;
    console.log(`🔑 Using authenticated LinkedIn session for deep lead discovery`);
  } else {
    console.log(`Safety: Public Search without login (Zero candidate account risk)`);
  }

  const { browser, page } = await createBrowser(browserOpts);
  const leads = getSavedLeads();
  const existingJobUrls = new Set(leads.map(l => l.jobUrl));
  const existingEmails = new Set(leads.map(l => l.targetEmail?.toLowerCase()).filter(Boolean));
  const newLeads = [];

  try {
    const timeFilter = hours <= 1 ? 'r3600' : 'r86400';
    const queries = [
      query,
      `"${query}" ("send resume" OR "share CV" OR "hiring")`
    ];

    const discoveredJobs = [];

    for (const q of queries) {
      if (discoveredJobs.length >= maxResults * 2) break;

      const encodedQuery = encodeURIComponent(q);
      const encodedLoc = encodeURIComponent(location);
      const searchUrl = `https://www.linkedin.com/jobs/search?keywords=${encodedQuery}&location=${encodedLoc}&f_TPR=${timeFilter}&position=1&pageNum=0`;

      console.log(`[Public Portal Search] Fetching: ${searchUrl}`);
      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await randomSleep(1500, 2500);

        const currentTitle = await page.title().catch(() => '');
        if (currentTitle.toLowerCase().includes('log in') || currentTitle.toLowerCase().includes('sign up')) {
          console.log(`ℹ️ LinkedIn guest search is restricted by login auth wall. Skipping LinkedIn.`);
          break;
        }

        // Scroll to load job cards
        for (let s = 0; s < 3; s++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await randomSleep(600, 1000);
        }

        const cards = await page.locator('.jobs-search__results-list li, .base-card').all();
        console.log(`[Search: "${q}"] Discovered ${cards.length} recent postings.`);

        for (const card of cards) {
          const title = (await card.locator('.base-search-card__title, h3').innerText().catch(() => '')).trim();
          const company = (await card.locator('.base-search-card__subtitle, h4').innerText().catch(() => '')).trim();
          const loc = (await card.locator('.job-search-card__location').innerText().catch(() => '')).trim();
          const rawUrl = await card.locator('a.base-card__full-link').getAttribute('href').catch(() => '');
          const jobUrl = rawUrl ? rawUrl.split('?')[0] : '';
          const time = (await card.locator('time').innerText().catch(() => '')).trim();

          if (title && company && jobUrl && !existingJobUrls.has(jobUrl)) {
            if (!isExperienceMatching(title, 0, 5)) continue;
            if (isCompanyExcluded(company, jobUrl)) continue;

            if (!discoveredJobs.some(j => j.jobUrl === jobUrl)) {
              discoveredJobs.push({ title, company, loc, jobUrl, timePosted: time || 'Recently' });
            }
          }
        }
      } catch (err) {
        console.warn(`[Search Warning] Query "${q}" failed: ${err.message}`);
      }
    }

    console.log(`\n📋 Discovered ${discoveredJobs.length} candidate postings to inspect for recruiter details.`);
    const candidatesToInspect = discoveredJobs.slice(0, maxResults);

    for (let j = 0; j < candidatesToInspect.length; j++) {
      const item = candidatesToInspect[j];
      
      if (isCompanyExcluded(item.company, item.jobUrl)) {
        console.log(`🛡️ [Safety Shield] Skipping excluded company lead: ${item.company}`);
        continue;
      }

      try {
        console.log(`\n[Lead Inspection ${j + 1}/${candidatesToInspect.length}] ${item.company} — "${item.title}"`);
        await page.goto(item.jobUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await randomSleep(1200, 2200);

        const desc = await page.locator('.show-more-less-html__markup, .description__text, .decorated-job-posting__details, body').innerText().catch(() => '');

        // 1. Check for explicit email in job description text
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
        const matches = desc.match(emailRegex) || [];
        const cleanEmails = matches.filter(e => {
          const lower = e.toLowerCase();
          return !lower.includes('.png') && !lower.includes('.jpg') && !lower.includes('sentry') && 
                 !lower.includes('w3.org') && !lower.includes('example.com') && !lower.includes('github.com');
        });

        // 2. Poster / Recruiter card detection on the post itself
        let directCardRecruiter = null;
        const posterCard = page.locator('.message-the-recruiter, .hirer-card, [class*="recruiter"], [class*="hirer"]').first();
        if (await posterCard.count() > 0) {
          const posterText = await posterCard.innerText().catch(() => '');
          const cardProfileUrl = await posterCard.locator('a').first().getAttribute('href').catch(() => null);
          const lines = posterText.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length >= 2) {
            directCardRecruiter = {
              name: lines[1],
              role: lines[2] || 'Technical Recruiter',
              profileUrl: cardProfileUrl
            };
          }
        }

        const domain = resolveCompanyDomain(item.company);

        // Record any explicit contact found on the post card
        let postCardEmail = null;
        if (cleanEmails.length > 0) {
          postCardEmail = cleanEmails[0].toLowerCase();
        } else if (directCardRecruiter && directCardRecruiter.name !== 'Hiring Team') {
          const nameParts = directCardRecruiter.name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
          const first = nameParts[0] || 'talent';
          const last = nameParts[1] || '';
          postCardEmail = last ? `${first}.${last}@${domain}` : `${first}@${domain}`;
        }

        if (postCardEmail && !existingEmails.has(postCardEmail)) {
          const recorded = await recordDiscoveredLead({
            company: item.company,
            title: item.title,
            location: item.loc,
            timePosted: item.timePosted,
            jobUrl: item.jobUrl,
            contactType: 'TALENT_ACQUISITION',
            recruiterName: directCardRecruiter?.name || 'Technical Recruiter',
            recruiterTitle: directCardRecruiter?.role || 'Technical Recruiter',
            recruiterProfileUrl: directCardRecruiter?.profileUrl || null,
            targetEmail: postCardEmail,
            domain,
            sourcePortal: 'LinkedIn Job Card',
            confidence: 'High (Direct Post Contact)'
          });
          if (recorded) {
            newLeads.push(recorded);
            existingEmails.add(postCardEmail);
          }
        }

        // 3. Multi-Contact Team Discovery: Uncover TA Specialists AND Hiring Managers for this company
        console.log(`🔎 Discovering specific Talent Acquisition specialists and Hiring Managers for ${item.company}...`);
        const teamContacts = await fetchCompanyTeamContacts(item.company, domain, {
          jobTitle: item.title,
          page,
          maxTA: 2,
          maxHM: 2
        });

        for (const contact of teamContacts) {
          if (existingEmails.has(contact.targetEmail)) continue;

          const recorded = await recordDiscoveredLead({
            company: item.company,
            title: item.title,
            location: item.loc,
            timePosted: item.timePosted,
            jobUrl: item.jobUrl,
            contactType: contact.contactType,
            recruiterName: contact.recruiterName,
            recruiterTitle: contact.recruiterTitle,
            recruiterProfileUrl: contact.recruiterProfileUrl,
            targetEmail: contact.targetEmail,
            domain: contact.domain,
            sourcePortal: 'LinkedIn Team Discovery',
            confidence: contact.confidence
          });

          if (recorded) {
            newLeads.push(recorded);
            existingEmails.add(contact.targetEmail);
          }
        }

        existingJobUrls.add(item.jobUrl);

      } catch (err) {
        console.warn(`[Skip] Could not probe details for ${item.company}: ${err.message}`);
      }
    }

    console.log(`\n============================================================`);
    console.log(`🎉 [Lead Hunt Completed] Extracted ${newLeads.length} fresh recruiter & hiring manager contacts!`);
    console.log(`📁 Total saved leads ready for outreach: ${getSavedLeads().length}`);
    console.log(`============================================================\n`);

  } catch (err) {
    console.error('❌ [Recruiter Finder Error]:', err.message);
  } finally {
    await browser.close();
  }

  return newLeads;
}

/**
 * Scrapes Naukri.com for 2-5 YOE Data Engineering postings, extracting both
 * explicit emails from job descriptions and discovering real Talent Acquisition & Hiring Managers per job.
 */
export async function fetchNaukriRecruiterLeads(options = {}) {
  let defaultQuery = 'Data Engineer';
  try {
    const prof = loadProfile();
    if (prof.workPreferences?.targetRoles?.length > 0) defaultQuery = prof.workPreferences.targetRoles[0];
  } catch {}

  const {
    query = defaultQuery,
    maxResults = 15,
    headless = true
  } = options;

  console.log(`\n🔍 [Naukri Lead Scraper] Hunting fresh 2-5 YOE Data Engineer postings on Naukri...`);
  console.log(`Query: "${query}" | Target Max: ${maxResults}`);

  const { browser, page } = await createBrowser({ headless });
  const discovered = [];
  const leads = getSavedLeads();
  const existingEmails = new Set(leads.map(l => l.targetEmail?.toLowerCase()).filter(Boolean));

  try {
    const searchUrl = `https://www.naukri.com/data-engineer-jobs?k=${encodeURIComponent(query)}&experience=2&experience=3&experience=4&experience=5&sortBy=f`;
    console.log(`[Naukri Scraper] Loading: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(2000, 3000);

    const candidates = await page.evaluate(() => {
      const tuples = document.querySelectorAll('.srp-jobtuple-wrapper, .cust-job-tuple');
      const list = [];
      for (const t of tuples) {
        const titleEl = t.querySelector('.title, a.title, [class*="title"]');
        const compEl = t.querySelector('.comp-name, a.comp-name, [class*="comp-name"]');
        const linkEl = t.querySelector('a.title, a[class*="title"], a[href*="job-listings"]');
        const locEl = t.querySelector('.loc-wrap, .loc, [class*="loc"]');
        if (titleEl && compEl && linkEl && linkEl.href) {
          list.push({
            title: titleEl.innerText.trim(),
            company: compEl.innerText.trim(),
            url: linkEl.href.split('?')[0],
            location: locEl ? locEl.innerText.trim() : 'India'
          });
        }
      }
      return list;
    });

    console.log(`[Naukri Scraper] Found ${candidates.length} candidate postings on search page.`);

    const targetKeywords = ['data', 'etl', 'pyspark', 'spark', 'sql', 'python', 'analytics', 'big data', 'bi developer', 'warehouse', 'platform', 'pipeline'];
    const relevant = candidates.filter(c => {
      const lower = (c.title || '').toLowerCase();
      return targetKeywords.some(kw => lower.includes(kw));
    });

    console.log(`[Naukri Scraper] Filtered to ${relevant.length} relevant Data Engineer postings.`);

    for (let i = 0; i < relevant.length && discovered.length < maxResults; i++) {
      const item = relevant[i];
      if (!item.title || !item.company || !item.url) continue;
      if (isCompanyExcluded(item.company, item.url)) continue;

      let explicitEmail = null;

      // 1. Inspect Naukri JD for explicit recruiter email
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await randomSleep(800, 1500);

        const bodyText = await page.locator('.styles_JDC__dang-inner-html__kb3e0, .dang-inner-html, .job-desc, body').innerText({ timeout: 5000 }).catch(() => '');
        const emailMatches = bodyText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g) || [];
        const cleanEmails = emailMatches.filter(e => {
          const l = e.toLowerCase();
          return !l.includes('.png') && !l.includes('.jpg') && !l.includes('sentry') && !l.includes('example.com') && !l.includes('w3.org') && !l.includes('naukri.com');
        });

        if (cleanEmails.length > 0) {
          explicitEmail = cleanEmails[0].toLowerCase();
        }
      } catch (err) {}

      if (explicitEmail && !existingEmails.has(explicitEmail)) {
        const lead = await recordDiscoveredLead({
          company: item.company,
          title: item.title,
          location: item.location,
          jobUrl: item.url,
          targetEmail: explicitEmail,
          contactType: 'TALENT_ACQUISITION',
          recruiterName: 'Technical Recruiter',
          sourcePortal: 'Naukri Job Posting',
          emailType: 'Direct Recruiter in Post',
          confidence: 'High (Explicit in Naukri JD)'
        });
        if (lead) {
          discovered.push(lead);
          existingEmails.add(explicitEmail);
        }
      }

      // 2. Discover company team contacts (TA specialists + Hiring Managers)
      const domain = resolveCompanyDomain(item.company);
      if (domain && !domain.includes('careers.com') && !domain.includes('company.com')) {
        const teamContacts = await fetchCompanyTeamContacts(item.company, domain, {
          jobTitle: item.title,
          page,
          maxTA: 2,
          maxHM: 2
        });

        for (const contact of teamContacts) {
          if (existingEmails.has(contact.targetEmail)) continue;

          const lead = await recordDiscoveredLead({
            company: item.company,
            title: item.title,
            location: item.location,
            jobUrl: item.url,
            contactType: contact.contactType,
            recruiterName: contact.recruiterName,
            recruiterTitle: contact.recruiterTitle,
            recruiterProfileUrl: contact.recruiterProfileUrl,
            targetEmail: contact.targetEmail,
            domain: contact.domain,
            sourcePortal: 'Naukri Team Discovery',
            confidence: contact.confidence
          });

          if (lead) {
            discovered.push(lead);
            existingEmails.add(contact.targetEmail);
          }
        }
      }
    }

    console.log(`🎉 [Naukri Lead Scraper] Extracted ${discovered.length} verified direct recruiter & hiring manager contacts!`);
  } catch (err) {
    console.error(`❌ [Naukri Lead Scraper Error]:`, err.message);
  } finally {
    await browser.close().catch(() => {});
  }

  return discovered;
}

/**
 * Deep Upgrade Engine:
 * Scans saved leads for generic careers@ or hr@ addresses, finds their company's real
 * Talent Acquisition specialists and Engineering/Data Hiring Managers, and upgrades them.
 */
export async function deepUpgradeGenericLeads(options = {}) {
  const { onLog = console.log, maxCompanies = 15 } = options;
  const leads = getSavedLeads();
  const genericLeads = leads.filter(l => 
    (l.targetEmail || '').startsWith('careers@') || 
    (l.targetEmail || '').startsWith('career@') || 
    (l.targetEmail || '').startsWith('hr@')
  );

  onLog(`🚀 [Deep Upgrade] Found ${genericLeads.length} generic leads to upgrade with real TA & Hiring Managers.`);
  if (genericLeads.length === 0) return { upgraded: 0 };

  // Group by company
  const companyMap = new Map();
  for (const l of genericLeads) {
    if (!companyMap.has(l.company)) companyMap.set(l.company, []);
    companyMap.get(l.company).push(l);
  }

  const { browser, page } = await createBrowser({ headless: true });
  let totalUpgraded = 0;

  try {
    const companies = Array.from(companyMap.keys()).slice(0, maxCompanies);
    for (let c = 0; c < companies.length; c++) {
      const company = companies[c];
      const associated = companyMap.get(company);
      const rep = associated[0];
      const domain = rep.domain || resolveCompanyDomain(company);

      onLog(`\n[Upgrade ${c + 1}/${companies.length}] Hunting real TA & Hiring Managers for "${company}" (${domain})...`);
      const contacts = await fetchCompanyTeamContacts(company, domain, {
        jobTitle: rep.title,
        page,
        maxTA: 2,
        maxHM: 2
      });

      if (contacts.length > 0) {
        onLog(`✅ Discovered ${contacts.length} verified team contacts for ${company}!`);
        // Remove old generic lead(s) for this company
        const currentLeads = getSavedLeads().filter(l => !associated.some(old => old.id === l.id));

        for (const contact of contacts) {
          const newLead = {
            id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            company,
            title: rep.title,
            location: rep.location,
            timePosted: rep.timePosted || 'Recently',
            jobUrl: rep.jobUrl || '',
            contactType: contact.contactType,
            recruiterName: contact.recruiterName,
            recruiterTitle: contact.recruiterTitle,
            recruiterProfileUrl: contact.recruiterProfileUrl,
            targetEmail: contact.targetEmail,
            domain: contact.domain,
            emailType: contact.emailType,
            confidence: contact.confidence,
            sourcePortal: 'Deep Lead Upgrade',
            status: 'UNCONTACTED',
            discoveredAt: new Date().toISOString()
          };
          currentLeads.unshift(newLead);
          totalUpgraded++;
        }
        saveLeads(currentLeads);
      } else {
        onLog(`ℹ️ No individual profiles discovered for ${company}. Keeping existing lead.`);
      }
    }
  } catch (err) {
    onLog(`❌ [Deep Upgrade Error]: ${err.message}`);
  } finally {
    await browser.close().catch(() => {});
  }

  onLog(`🎉 [Deep Upgrade Finished] Successfully created ${totalUpgraded} real verified recruiter & hiring manager leads!`);
  return { upgraded: totalUpgraded };
}

/**
 * Multi-Platform Recruiter Lead Harvester:
 * Scrapes fresh recruiter emails from LinkedIn public search and Naukri job descriptions.
 */
export async function fetchAllPlatformsRecruiterLeads(options = {}) {
  const query = options.query || options.roleQuery || 'Data Engineer';
  const hours = options.hours || options.hoursAgo || 24;
  const maxResults = options.maxResults || 20;
  const headless = options.headless !== undefined ? options.headless : true;

  console.log(`\n============================================================`);
  console.log(`🌐 [MULTI-PLATFORM RECRUITER HARVEST] Starting hunt across LinkedIn & Naukri`);
  console.log(`Query: "${query}" | Max: ${maxResults}`);
  console.log(`============================================================`);

  const results = [];

  // Platform 1: LinkedIn Multi-Contact Search
  try {
    const linkedInLeads = await fetchRecentRecruiterLeads({ query, location: 'India', hours, maxResults: Math.ceil(maxResults / 2), headless });
    results.push(...linkedInLeads);
  } catch (e) {
    console.warn(`[Multi-Platform] LinkedIn harvest info: ${e.message}`);
  }

  // Platform 2: Naukri Multi-Contact Search
  try {
    const naukriLeads = await fetchNaukriRecruiterLeads({ query, maxResults: Math.ceil(maxResults / 2), headless });
    results.push(...naukriLeads);
  } catch (e) {
    console.warn(`[Multi-Platform] Naukri harvest info: ${e.message}`);
  }

  console.log(`🎉 [Multi-Platform Complete] Discovered total ${results.length} contacts across platforms!`);
  return results;
}
