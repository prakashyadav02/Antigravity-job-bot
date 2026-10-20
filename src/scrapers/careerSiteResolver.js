/**
 * Career Site & ATS Resolver.
 * Given any company name, automatically determines which ATS platform the company uses
 * (Greenhouse, Lever, Ashby, or Direct Portal) and extracts active jobs.
 */

const atsCache = new Map();

/**
 * Generate potential slug variations for a company name
 * E.g., "PhonePe" -> ["phonepe"], "Razorpay" -> ["razorpay", "razorpaysoftware"]
 */
function generateCompanySlugs(companyName) {
  const cleaned = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slugs = [cleaned];

  // Common corporate suffixes stripped
  const base = companyName
    .toLowerCase()
    .replace(/\b(inc|ltd|pvt|technologies|technology|solutions|software|india|corp|corporation|global|services)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

  if (base && !slugs.includes(base)) {
    slugs.push(base);
  }

  return slugs;
}

export async function resolveCompanyATS(companyName) {
  if (!companyName) {
    return { ats: 'Unknown', boardUrl: null, matchingRoles: [] };
  }

  const cached = atsCache.get(companyName.toLowerCase());
  if (cached) return cached;

  const slugs = generateCompanySlugs(companyName);

  for (const slug of slugs) {
    // 1. Check Greenhouse
    try {
      const ghRes = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`, {
        signal: AbortSignal.timeout(4000)
      });
      if (ghRes.ok) {
        const data = await ghRes.json();
        const jobs = (data.jobs || []).map(j => ({
          id: j.id,
          title: j.title,
          location: j.location ? j.location.name : 'Unknown',
          url: j.absolute_url || `https://job-boards.greenhouse.io/${slug}/jobs/${j.id}`,
          platform: 'Greenhouse'
        }));

        const result = {
          company: companyName,
          ats: 'Greenhouse',
          token: slug,
          boardUrl: `https://job-boards.greenhouse.io/${slug}`,
          totalJobs: jobs.length,
          matchingRoles: jobs
        };
        atsCache.set(companyName.toLowerCase(), result);
        return result;
      }
    } catch {}

    // 2. Check Lever
    try {
      const leverRes = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`, {
        signal: AbortSignal.timeout(4000)
      });
      if (leverRes.ok) {
        const postings = await leverRes.json();
        const jobs = (postings || []).map(p => ({
          id: p.id,
          title: p.text,
          location: p.categories?.location || 'Unknown',
          url: p.applyUrl || p.hostedUrl,
          platform: 'Lever'
        }));

        const result = {
          company: companyName,
          ats: 'Lever',
          token: slug,
          boardUrl: `https://jobs.lever.co/${slug}`,
          totalJobs: jobs.length,
          matchingRoles: jobs
        };
        atsCache.set(companyName.toLowerCase(), result);
        return result;
      }
    } catch {}

    // 3. Check Ashby
    try {
      const ashbyRes = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, {
        signal: AbortSignal.timeout(4000)
      });
      if (ashbyRes.ok) {
        const data = await ashbyRes.json();
        const jobs = (data.jobs || []).map(j => ({
          id: j.id,
          title: j.title,
          location: j.location || 'Unknown',
          url: j.jobUrl || `https://jobs.ashbyhq.com/${slug}/${j.id}`,
          platform: 'Ashby'
        }));

        const result = {
          company: companyName,
          ats: 'Ashby',
          token: slug,
          boardUrl: `https://jobs.ashbyhq.com/${slug}`,
          totalJobs: jobs.length,
          matchingRoles: jobs
        };
        atsCache.set(companyName.toLowerCase(), result);
        return result;
      }
    } catch {}
  }

  const fallback = {
    company: companyName,
    ats: 'Direct Career Portal',
    token: null,
    boardUrl: null,
    totalJobs: 0,
    matchingRoles: []
  };
  atsCache.set(companyName.toLowerCase(), fallback);
  return fallback;
}
