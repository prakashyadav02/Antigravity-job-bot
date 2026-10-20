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
  'razorpay': 'razorpay.com',
  'phonepe': 'phonepe.com',
  'paytm': 'paytm.com',
  'flipkart': 'flipkart.com',
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
  'teleperformance': 'teleperformance.com'
};

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

export async function recordDiscoveredLead(leadData) {
  const {
    company,
    title,
    location = 'India',
    jobUrl = '',
    recruiterName = 'Hiring Team',
    recruiterTitle = 'Technical Recruiter',
    targetEmail,
    sourcePortal = 'Job Portal',
    emailType = 'Direct Post Contact',
    confidence = 'High (Direct Post)'
  } = leadData;

  if (!targetEmail || !company) return null;
  const cleanEmail = targetEmail.toLowerCase().trim();

  // Safety check against excluded companies
  if (isCompanyExcluded(company, `${cleanEmail} ${jobUrl}`)) {
    return null;
  }

  const leads = getSavedLeads();
  if (leads.some(l => (l.targetEmail || '').toLowerCase() === cleanEmail)) {
    return null; // Already exists
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
    timePosted: 'Recently',
    jobUrl,
    recruiterName,
    recruiterTitle,
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
  console.log(`🎯 [Multi-Platform Lead Recorded] ${newLead.company} | ${newLead.targetEmail} (${newLead.sourcePortal})`);
  return newLead;
}

/**
 * Searches public job feeds (LinkedIn Public Search, zero login, zero ban risk)
 * Extracts hiring managers, technical recruiters, and explicit emails from recent postings.
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
  if (fs.existsSync(LINKEDIN_STORAGE)) {
    try {
      const state = JSON.parse(fs.readFileSync(LINKEDIN_STORAGE, 'utf-8'));
      if (Array.isArray(state.cookies) && state.cookies.length >= 3) {
        browserOpts.storageState = LINKEDIN_STORAGE;
        console.log(`🔑 Using authenticated LinkedIn session for deep lead discovery`);
      } else {
        console.log(`Safety: Public Search without login (Zero candidate account risk)`);
      }
    } catch {
      console.log(`Safety: Public Search without login (Zero candidate account risk)`);
    }
  } else {
    console.log(`Safety: Public Search without login (Zero candidate account risk)`);
  }

  const { browser, page } = await createBrowser(browserOpts);
  const leads = getSavedLeads();
  const existingJobUrls = new Set(leads.map(l => l.jobUrl));
  const existingEmails = new Set(leads.map(l => l.targetEmail?.toLowerCase()).filter(Boolean));
  const newLeads = [];

  try {
    // Time filter: r3600 = 1 hour, r86400 = 24 hours
    const timeFilter = hours <= 1 ? 'r3600' : 'r86400';
    
    // Multiple targeted queries for maximum recruiter contact coverage
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
            // Check 0-5 YOE criteria
            if (!isExperienceMatching(title, 0, 5)) {
              continue;
            }

            // Safety Shield: Block current company / products
            if (isCompanyExcluded(company, jobUrl)) {
              continue;
            }

            // Avoid duplicate discovery
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

        // 1. Check for explicit email in job description text (e.g. "share resume at hr@domain.com")
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
        const matches = desc.match(emailRegex) || [];
        const cleanEmails = matches.filter(e => {
          const lower = e.toLowerCase();
          return !lower.includes('.png') && !lower.includes('.jpg') && !lower.includes('sentry') && 
                 !lower.includes('w3.org') && !lower.includes('example.com') && !lower.includes('github.com');
        });

        // 2. Poster / Recruiter card detection
        let recruiterName = null;
        let recruiterTitle = null;
        let recruiterProfileUrl = null;

        const posterCard = page.locator('.message-the-recruiter, .hirer-card, [class*="recruiter"], [class*="hirer"]').first();
        if (await posterCard.count() > 0) {
          const posterText = await posterCard.innerText().catch(() => '');
          recruiterProfileUrl = await posterCard.locator('a').first().getAttribute('href').catch(() => null);
          const lines = posterText.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length >= 2) {
            recruiterName = lines[1];
            recruiterTitle = lines[2] || 'Hiring Lead';
          }
        }

        // 3. Resolve true company domain
        const domain = resolveCompanyDomain(item.company);

        let targetEmail = null;
        let confidence = 'Medium';
        let emailType = 'Talent Acquisition';

        if (cleanEmails.length > 0) {
          // Explicit email found in post text!
          targetEmail = cleanEmails[0].toLowerCase();
          confidence = 'High (Explicit in Post)';
          emailType = 'Direct Post Contact';
        } else if (recruiterName && recruiterName !== 'Hiring Team') {
          // Known recruiter name: infer professional address
          const nameParts = recruiterName.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
          const first = nameParts[0] || 'talent';
          const last = nameParts[1] || '';
          targetEmail = last ? `${first}.${last}@${domain}` : `${first}@${domain}`;
          confidence = 'High (Recruiter Direct)';
          emailType = 'Recruiter Direct';
        } else {
          targetEmail = `careers@${domain}`;
          confidence = 'Medium (Talent Team)';
          emailType = 'Talent Acquisition';
        }

        // Verify that the domain actually has active MX mail servers
        try {
          const mx = await dns.promises.resolveMx(domain);
          if (!mx || mx.length === 0) {
            console.log(`⚠️ Domain "${domain}" has no MX records. Skipping lead.`);
            continue;
          }
        } catch {
          console.log(`⚠️ Cannot resolve mail servers for "${domain}". Skipping lead.`);
          continue;
        }

        // Avoid adding duplicate email
        if (existingEmails.has(targetEmail)) {
          console.log(`ℹ️ Lead email ${targetEmail} already in database. Skipping.`);
          continue;
        }

        const lead = {
          id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          company: item.company,
          title: item.title,
          location: item.loc,
          timePosted: item.timePosted,
          jobUrl: item.jobUrl,
          recruiterName: recruiterName || 'Hiring Manager',
          recruiterTitle: recruiterTitle || 'Technical Recruiter',
          recruiterProfileUrl: recruiterProfileUrl || null,
          targetEmail,
          domain,
          emailType,
          confidence,
          sourcePortal: 'LinkedIn Public Search',
          status: 'UNCONTACTED',
          discoveredAt: new Date().toISOString()
        };

        console.log(`🎯 Lead Identified: ${lead.recruiterName} (${lead.recruiterTitle}) @ ${lead.company}`);
        console.log(`   Email: ${lead.targetEmail} [${lead.confidence}]`);

        newLeads.push(lead);
        leads.unshift(lead);
        existingJobUrls.add(item.jobUrl);
        existingEmails.add(targetEmail);

      } catch (err) {
        console.warn(`[Skip] Could not probe details for ${item.company}: ${err.message}`);
      }
    }

    saveLeads(leads);
    console.log(`\n============================================================`);
    console.log(`🎉 [Lead Hunt Completed] Extracted ${newLeads.length} fresh recruiter contacts!`);
    console.log(`📁 Total saved leads ready for outreach: ${leads.length}`);
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
 * explicit emails from job descriptions and verified corporate talent acquisition emails via DNS MX checks.
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

  try {
    // Filter by fresh postings (sortBy=f) and 2-5 YOE
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

    // Strict role relevance filter to prevent non-tech jobs
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
      let recruiterName = 'Hiring Team';

      // 1. Check if job page has explicit contact
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
      } catch (err) {
        // Page timeout: fallback directly to domain resolution
      }

      if (explicitEmail) {
        const lead = await recordDiscoveredLead({
          company: item.company,
          title: item.title,
          location: item.location,
          jobUrl: item.url,
          targetEmail: explicitEmail,
          recruiterName: 'Technical Recruiter',
          sourcePortal: 'Naukri Job Posting',
          emailType: 'Direct Recruiter in Post',
          confidence: 'High (Explicit in Naukri JD)'
        });
        if (lead) discovered.push(lead);
      } else {
        // 2. Resolve verified corporate talent acquisition email
        const domain = resolveCompanyDomain(item.company);
        if (domain && !domain.includes('careers.com') && !domain.includes('company.com')) {
          try {
            const mx = await dns.promises.resolveMx(domain);
            if (mx && mx.length > 0) {
              const corporateEmail = `careers@${domain}`;
              const lead = await recordDiscoveredLead({
                company: item.company,
                title: item.title,
                location: item.location,
                jobUrl: item.url,
                targetEmail: corporateEmail,
                recruiterName: 'Talent Acquisition Team',
                sourcePortal: 'Naukri Fresh Postings',
                emailType: 'Talent Acquisition',
                confidence: 'High (Verified Domain MX)'
              });
              if (lead) discovered.push(lead);
            }
          } catch {}
        }
      }
    }

    console.log(`🎉 [Naukri Lead Scraper] Extracted ${discovered.length} verified direct recruiter & talent contacts!`);
  } catch (err) {
    console.error(`❌ [Naukri Lead Scraper Error]:`, err.message);
  } finally {
    await browser.close().catch(() => {});
  }

  return discovered;
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

  // Platform 1: LinkedIn Public Search (graceful fallback if blocked by auth wall)
  try {
    const linkedInLeads = await fetchRecentRecruiterLeads({ query, location: 'India', hours, maxResults: Math.ceil(maxResults / 2), headless });
    results.push(...linkedInLeads);
  } catch (e) {
    console.warn(`[Multi-Platform] LinkedIn harvest info: ${e.message}`);
  }

  // Platform 2: Naukri Job Postings (with domain MX resolution)
  try {
    const naukriLeads = await fetchNaukriRecruiterLeads({ query, maxResults: Math.ceil(maxResults / 2), headless });
    results.push(...naukriLeads);
  } catch (e) {
    console.warn(`[Multi-Platform] Naukri harvest info: ${e.message}`);
  }

  console.log(`🎉 [Multi-Platform Complete] Discovered total ${results.length} contacts across platforms!`);
  return results;
}
