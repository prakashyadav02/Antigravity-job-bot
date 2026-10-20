import { isCompanyExcluded } from '../config.js';

/**
 * Discovers open jobs from Greenhouse and Lever company boards via their public APIs.
 */

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

export async function fetchGreenhouseJobs(boardToken) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return (data.jobs || []).map(j => ({
      platform: 'greenhouse',
      company: boardToken,
      id: j.id,
      title: j.title,
      location: j.location ? j.location.name : 'Unknown',
      url: j.id ? `https://job-boards.greenhouse.io/${boardToken}/jobs/${j.id}` : j.absolute_url,
      updatedAt: j.updated_at
    }));
  } catch (err) {
    return [];
  }
}

export async function fetchLeverJobs(companyToken) {
  try {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(companyToken)}?mode=json`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return [];
    }
    const postings = await res.json();
    return (postings || []).map(p => ({
      platform: 'lever',
      company: companyToken,
      id: p.id,
      title: p.text,
      location: p.categories?.location || p.categories?.workplaceType || 'Unknown',
      url: p.id ? `https://jobs.lever.co/${companyToken}/${p.id}/apply` : (p.applyUrl || p.hostedUrl),
      workplaceType: p.categories?.workplaceType || '',
      updatedAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString()
    }));
  } catch (err) {
    return [];
  }
}

export async function fetchAshbyJobs(companyToken) {
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(companyToken)}`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs || []).map(j => ({
      platform: 'ashby',
      company: companyToken,
      id: j.id,
      title: j.title,
      location: j.location || 'Unknown',
      url: j.jobUrl || `https://jobs.ashbyhq.com/${companyToken}/${j.id}`,
      workplaceType: j.employmentType || '',
      updatedAt: j.publishedAt || j.updatedAt || new Date().toISOString()
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Sorts jobs by freshness (newest first).
 * Accurately annotates age in hours and prioritizes postings within the last 1 hour.
 */
export function sortByFreshness(jobs, maxAgeHours = null) {
  const now = Date.now();
  const annotated = jobs.map(j => {
    const time = j.updatedAt ? new Date(j.updatedAt).getTime() : 0;
    const ageHours = time > 0 ? Math.max(0, (now - time) / (1000 * 60 * 60)) : 999;
    return {
      ...j,
      ageHours: parseFloat(ageHours.toFixed(1)),
      isFresh1Hour: ageHours <= 1.0,
      isFreshToday: ageHours <= 24.0
    };
  });

  // Sort newest first
  annotated.sort((a, b) => a.ageHours - b.ageHours);

  if (maxAgeHours !== null) {
    const strict = annotated.filter(j => j.ageHours <= maxAgeHours);
    if (strict.length >= 25) {
      return strict;
    }
  }

  return annotated;
}


/**
 * Evaluates whether a role's experience level matches candidate's target range (e.g. 0 - 5 years).
 */
export function isExperienceMatching(text, minTarget = 0, maxTarget = 5) {
  if (!text) return true;
  const clean = text.toLowerCase();

  // Exclude executive and senior leadership
  if (/\b(lead|principal|architect|director|vp|head of|chief|manager|staff)\b/i.test(clean)) {
    return false;
  }

  // Exclude entry/intern only if candidate specifically requested non-entry level (minTarget >= 2)
  if (minTarget >= 2 && /\b(intern|internship|trainee)\b/i.test(clean)) {
    return false;
  }

  // Explicit range: e.g. "0-2 years", "1-3 years", "2-5 years", "3-5 yrs", "0-5 yrs"
  const rangeMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i);
  if (rangeMatch) {
    const minReq = parseFloat(rangeMatch[1]);
    const maxReq = parseFloat(rangeMatch[2]);
    // If requirement starts above candidate max target (e.g. 6-8, 7.1-9), exclude
    if (minReq > maxTarget) return false;
    // If requirement ends below candidate min target (only if minTarget > 0), exclude
    if (minTarget > 0 && maxReq < minTarget) return false;
    return true;
  }

  // Explicit plus: e.g. "6+ years", "7+ yrs", "8+ years", "10+ years"
  const plusMatch = clean.match(/(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)/i);
  if (plusMatch) {
    const minReq = parseFloat(plusMatch[1]);
    if (minReq > maxTarget) return false;
  }

  return true;
}

/**
 * Enhanced India-focused matching filter.
 * Matches Indian cities, "India", "Remote - India", and global remote positions,
 * while safely filtering out jobs explicitly restricted to other regions.
 */
export function filterJobsForIndia(jobs, preferences) {
  const { targetRoles = [] } = preferences;
  const minExp = preferences?.minExperienceYears !== undefined ? preferences.minExperienceYears : 2;
  const maxExp = preferences?.maxExperienceYears !== undefined ? preferences.maxExperienceYears : 5;

  const roleKeywords = targetRoles.map(r => r.toLowerCase());

  const indianHubs = [
    'india',
    'bengaluru',
    'bangalore',
    'hyderabad',
    'pune',
    'gurgaon',
    'gurugram',
    'noida',
    'delhi',
    'mumbai',
    'chennai',
    'remote - india',
    'remote, india',
    'remote (india)',
    'apac',
    'anywhere'
  ];

  const foreignExclusions = [
    'united states',
    'us only',
    'usa',
    'canada',
    'united kingdom',
    'uk only',
    'germany',
    'emea only',
    'latam only',
    'australia',
    'ireland',
    'france'
  ];

  return jobs.filter(job => {
    // 0. Exclude current employer and affiliated entities
    if (isCompanyExcluded(job.company, job.url)) {
      return false;
    }

    const title = (job.title || '').toLowerCase();
    const location = (job.location || '').toLowerCase();
    const workplace = (job.workplaceType || '').toLowerCase();
    const fullLocText = `${location} ${workplace}`;

    // 1. Role match
    const matchesRole = roleKeywords.length === 0 || roleKeywords.some(kw => title.includes(kw));
    if (!matchesRole) return false;

    // 2. Experience level match (2 - 5 years)
    if (!isExperienceMatching(job.title, minExp, maxExp)) {
      return false;
    }

    // 2. Foreign location exclusion check (unless India is explicitly mentioned)
    const mentionsIndiaExplicitly = fullLocText.includes('india') || 
                                    fullLocText.includes('bangalore') || 
                                    fullLocText.includes('bengaluru') || 
                                    fullLocText.includes('hyderabad') ||
                                    fullLocText.includes('pune') ||
                                    fullLocText.includes('gurgaon') ||
                                    fullLocText.includes('gurugram') ||
                                    fullLocText.includes('noida') ||
                                    fullLocText.includes('mumbai') ||
                                    fullLocText.includes('delhi') ||
                                    fullLocText.includes('chennai');

    if (!mentionsIndiaExplicitly && foreignExclusions.some(ex => fullLocText.includes(ex))) {
      return false;
    }

    // Exclude if it explicitly says Remote in another country (e.g., 'Remote - US', 'US - Remote', 'Remote, Poland', 'Remote - EMEA')
    if (!mentionsIndiaExplicitly && /\b(us|usa|poland|uk|germany|japan|france|canada|korea|emea|latam|brazil|mexico|singapore|spain|italy|ireland|australia|nz)\b\s*[-–(,]?\s*remote/i.test(fullLocText)) {
      return false;
    }
    if (!mentionsIndiaExplicitly && /remote\s*[-–(,]?\s*\b(us|usa|poland|uk|germany|japan|france|canada|korea|emea|latam|brazil|mexico|singapore|spain|italy|ireland|australia|nz)\b/i.test(fullLocText)) {
      return false;
    }

    // 3. Indian Hub or Global Remote match
    const isIndiaHub = indianHubs.some(hub => fullLocText.includes(hub));
    const isGenericRemote = (fullLocText.includes('remote') || workplace.includes('remote')) && 
                            !foreignExclusions.some(ex => fullLocText.includes(ex)) &&
                            !/remote\s*[-–(,]?\s*[a-z]+/i.test(fullLocText); // If remote has a country specified and it wasn't India, exclude

    return mentionsIndiaExplicitly || isIndiaHub || (isGenericRemote && !fullLocText.includes('office based'));
  });
}
