import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../../.env');
const PROFILE_PATH = path.resolve(__dirname, '../../config/profile.json');

/**
 * Reads existing .env file into key-value map
 */
export function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const content = fs.readFileSync(ENV_PATH, 'utf-8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

/**
 * Updates .env file while preserving existing comments
 */
export function writeEnv(updates = {}) {
  let lines = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
  }

  const updatedKeys = new Set();
  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      if (key in updates) {
        updatedKeys.add(key);
        // Also update runtime process.env
        process.env[key] = updates[key];
        return `${key}=${updates[key]}`;
      }
    }
    return line;
  });

  // Append any newly added keys not present in original file
  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      newLines.push(`${key}=${val}`);
      process.env[key] = val;
    }
  }

  fs.writeFileSync(ENV_PATH, newLines.join('\n'), 'utf-8');
}

/**
 * Retrieves full settings: credentials (.env) + screening Q&A (profile.json)
 */
export function getFullSettings() {
  const env = readEnv();
  let prof = {};
  if (fs.existsSync(PROFILE_PATH)) {
    try {
      prof = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
    } catch {}
  }

  return {
    credentials: {
      naukriEmail: env.NAUKRI_EMAIL || process.env.NAUKRI_EMAIL || '',
      naukriPassword: env.NAUKRI_PASSWORD || process.env.NAUKRI_PASSWORD || '',
      gmailUser: env.GMAIL_USER || process.env.GMAIL_USER || '',
      gmailAppPassword: env.GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '',
      linkedinEmail: env.LINKEDIN_EMAIL || process.env.LINKEDIN_EMAIL || '',
      linkedinPassword: env.LINKEDIN_PASSWORD || process.env.LINKEDIN_PASSWORD || '',
      geminiApiKey: env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || ''
    },
    screening: {
      firstName: prof.personal?.firstName || 'Prakash Kumar',
      lastName: prof.personal?.lastName || 'Yadav',
      phone: prof.personal?.phone || '+91 9220299305',
      currentLocation: prof.personal?.currentLocation || 'Noida, India',
      currentCompany: prof.experience?.currentCompany || 'SOLIZE India Technologies Private Limited',
      currentTitle: prof.experience?.currentTitle || 'Data Engineer',
      totalYears: prof.experience?.totalYears || '2.8+',
      noticePeriodDays: prof.workPreferences?.effectiveNoticePeriodDays || 15,
      officialNoticePeriodDays: prof.workPreferences?.officialNoticePeriodDays || 30,
      noticePeriodTerms: prof.workPreferences?.noticePeriodTerms || '15 Days (Negotiable / Buyout possible)',
      servingNoticePeriod: prof.workPreferences?.servingNoticePeriod || 'No',
      currentSalary: prof.workPreferences?.currentSalary || '10 LPA',
      expectedSalary: prof.workPreferences?.expectedSalary || '15 LPA',
      targetLocations: Array.isArray(prof.workPreferences?.targetLocations) 
        ? prof.workPreferences.targetLocations.join(', ') 
        : 'Noida, Gurgaon, Hyderabad, Bengaluru, Pune, Delhi NCR, Remote',
      primarySkills: prof.customAnswers?.primarySkills || 'Python, PySpark, Apache Spark, SQL, Databricks, Apache Airflow, Kafka, PostgreSQL, AWS S3',
      authorizedToWork: prof.legalAndScreening?.authorizedToWork || 'Yes',
      willingToRelocate: prof.workPreferences?.willingToRelocate || 'Yes'
    }
  };
}

/**
 * Saves full settings to .env and profile.json
 */
export function saveFullSettings(payload = {}) {
  const { credentials, screening } = payload;

  // 1. Save credentials to .env
  if (credentials) {
    const envUpdates = {};
    if (credentials.naukriEmail !== undefined) envUpdates.NAUKRI_EMAIL = credentials.naukriEmail;
    if (credentials.naukriPassword !== undefined) envUpdates.NAUKRI_PASSWORD = credentials.naukriPassword;
    if (credentials.gmailUser !== undefined) envUpdates.GMAIL_USER = credentials.gmailUser;
    if (credentials.gmailAppPassword !== undefined) envUpdates.GMAIL_APP_PASSWORD = credentials.gmailAppPassword;
    if (credentials.linkedinEmail !== undefined) envUpdates.LINKEDIN_EMAIL = credentials.linkedinEmail;
    if (credentials.linkedinPassword !== undefined) envUpdates.LINKEDIN_PASSWORD = credentials.linkedinPassword;
    if (credentials.geminiApiKey !== undefined) envUpdates.GEMINI_API_KEY = credentials.geminiApiKey;
    writeEnv(envUpdates);
  }

  // 2. Save screening answers to config/profile.json
  if (screening && fs.existsSync(PROFILE_PATH)) {
    const prof = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));

    if (!prof.personal) prof.personal = {};
    if (screening.firstName) prof.personal.firstName = screening.firstName;
    if (screening.lastName) prof.personal.lastName = screening.lastName;
    if (screening.phone) prof.personal.phone = screening.phone;
    if (screening.currentLocation) prof.personal.currentLocation = screening.currentLocation;

    if (!prof.experience) prof.experience = {};
    if (screening.currentCompany) prof.experience.currentCompany = screening.currentCompany;
    if (screening.currentTitle) prof.experience.currentTitle = screening.currentTitle;
    if (screening.totalYears) prof.experience.totalYears = screening.totalYears;

    if (!prof.workPreferences) prof.workPreferences = {};
    if (screening.noticePeriodDays) prof.workPreferences.effectiveNoticePeriodDays = parseInt(screening.noticePeriodDays, 10) || 15;
    if (screening.officialNoticePeriodDays) prof.workPreferences.officialNoticePeriodDays = parseInt(screening.officialNoticePeriodDays, 10) || 30;
    if (screening.noticePeriodTerms) prof.workPreferences.noticePeriodTerms = screening.noticePeriodTerms;
    if (screening.servingNoticePeriod) prof.workPreferences.servingNoticePeriod = screening.servingNoticePeriod;
    if (screening.currentSalary) prof.workPreferences.currentSalary = screening.currentSalary;
    if (screening.expectedSalary) prof.workPreferences.expectedSalary = screening.expectedSalary;
    if (screening.willingToRelocate) prof.workPreferences.willingToRelocate = screening.willingToRelocate;

    if (screening.targetLocations) {
      prof.workPreferences.targetLocations = screening.targetLocations.split(',').map(l => l.trim()).filter(Boolean);
    }

    if (!prof.customAnswers) prof.customAnswers = {};
    if (screening.primarySkills) prof.customAnswers.primarySkills = screening.primarySkills;
    if (screening.totalYears) prof.customAnswers.yearsOfExperience = screening.totalYears;
    if (screening.currentCompany) prof.customAnswers.currentCompany = screening.currentCompany;

    if (!prof.legalAndScreening) prof.legalAndScreening = {};
    if (screening.authorizedToWork) prof.legalAndScreening.authorizedToWork = screening.authorizedToWork;

    fs.writeFileSync(PROFILE_PATH, JSON.stringify(prof, null, 2), 'utf-8');
  }

  return { success: true, message: 'Settings & credentials successfully saved.' };
}
