import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../data/applied_jobs.json');

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2), 'utf-8');
  }
}

export function getApplications() {
  ensureDbFile();
  try {
    const content = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(content || '[]');
  } catch {
    return [];
  }
}

export function isAlreadyApplied(url, options = {}) {
  const { includeSkipped = true } = options;
  const apps = getApplications();
  const cleanUrl = (url || '').split('?')[0].toLowerCase().trim();
  if (!cleanUrl) return false;

  return apps.some(app => {
    const appUrl = (app.url || '').split('?')[0].toLowerCase().trim();
    if (appUrl !== cleanUrl) return false;

    // Any successfully submitted application is permanently applied
    if (app.status === 'SUBMITTED' || app.status === 'VERIFIED_SUBMITTED') {
      return true;
    }

    // Skip recently attempted/unconfirmed jobs within the last 24 hours so we don't loop on them
    if (includeSkipped && (app.status === 'SKIPPED_UNCONFIRMED' || app.status === 'FAILED')) {
      const appliedTime = app.appliedAt ? new Date(app.appliedAt).getTime() : 0;
      if (Date.now() - appliedTime < 24 * 60 * 60 * 1000) {
        return true;
      }
    }

    return false;
  });
}

export function isRoleAlreadyApplied(company, title) {
  const apps = getApplications();
  const targetComp = (company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!targetComp || !targetTitle) return false;

  return apps.some(app => {
    if (app.status !== 'SUBMITTED' && app.status !== 'VERIFIED_SUBMITTED') return false;
    const appComp = (app.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const appTitle = (app.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return appComp.includes(targetComp) && (appTitle.includes(targetTitle) || targetTitle.includes(appTitle));
  });
}

export function recordApplication({ company, title, url, platform, status = 'SUBMITTED', notes = '' }) {
  ensureDbFile();
  const apps = getApplications();
  const cleanUrl = url.split('?')[0].toLowerCase().trim();
  const existingIndex = apps.findIndex(app => app.url.split('?')[0].toLowerCase().trim() === cleanUrl);

  const entry = {
    id: existingIndex >= 0 ? apps[existingIndex].id : `app_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    company: company || 'Unknown Company',
    title: title || 'Unknown Title',
    url,
    platform: platform || 'ATS',
    status,
    appliedAt: new Date().toISOString(),
    notes
  };

  if (existingIndex >= 0) {
    apps[existingIndex] = entry;
  } else {
    apps.push(entry);
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(apps, null, 2), 'utf-8');
  return entry;
}

export function getTodayAppliedCount(platform = null) {
  const apps = getApplications();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startMs = startOfDay.getTime();

  return apps.filter(app => {
    if (app.status !== 'SUBMITTED' && app.status !== 'VERIFIED_SUBMITTED') return false;
    if (platform && (app.platform || '').toUpperCase() !== platform.toUpperCase()) return false;
    const appliedTime = app.appliedAt ? new Date(app.appliedAt).getTime() : 0;
    return appliedTime >= startMs;
  }).length;
}
