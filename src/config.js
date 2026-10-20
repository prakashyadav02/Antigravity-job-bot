import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadProfile(customPath = null) {
  const profilePath = customPath || path.resolve(__dirname, '../config/profile.json');
  
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile configuration not found at ${profilePath}. Please copy config/profile.template.json to config/profile.json and fill in your details.`);
  }

  const raw = fs.readFileSync(profilePath, 'utf-8');
  const profile = JSON.parse(raw);

  // Normalize resume path
  if (profile.documents && profile.documents.resumePath) {
    if (!path.isAbsolute(profile.documents.resumePath)) {
      profile.documents.resumePath = path.resolve(__dirname, '..', profile.documents.resumePath);
    }
  }

  return profile;
}

export const DEFAULT_EXCLUDED_COMPANIES = [];

/**
 * Checks if a company name, domain, or URL matches any excluded companies
 * (such as the candidate's current employer or affiliated products)
 */
export function isCompanyExcluded(companyName = '', contextString = '') {
  if (!companyName && !contextString) return false;
  
  let excludedList = DEFAULT_EXCLUDED_COMPANIES;
  try {
    const prof = loadProfile();
    if (Array.isArray(prof.excludedCompanies) && prof.excludedCompanies.length > 0) {
      excludedList = [...new Set([...DEFAULT_EXCLUDED_COMPANIES, ...prof.excludedCompanies.map(c => c.toLowerCase())])];
    }
  } catch {}

  const cleanContext = `${companyName} ${contextString}`.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const item of excludedList) {
    const cleanItem = item.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanItem && cleanContext.includes(cleanItem)) {
      return true;
    }
  }

  return false;
}
