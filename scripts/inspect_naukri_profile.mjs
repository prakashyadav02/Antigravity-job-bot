import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function inspectProfile() {
  console.log('Connecting to Naukri with saved session (READ-ONLY inspection)...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);

    const title = await page.title();
    const url = page.url();
    console.log('Page Title:', title);
    console.log('Current URL:', url);

    if (url.includes('/nlogin') || url.includes('/login')) {
      console.error('Session expired or login required.');
      return;
    }

    // Extract Profile Details safely using standard DOM APIs
    const data = await page.evaluate(() => {
      const getTxt = (sel) => {
        try {
          const el = document.querySelector(sel);
          return el ? el.innerText.trim() : null;
        } catch {
          return null;
        }
      };

      const getAllTxt = (sel) => {
        try {
          return Array.from(document.querySelectorAll(sel)).map(el => el.innerText.trim()).filter(Boolean);
        } catch {
          return [];
        }
      };

      // Search all cards / widgets on the page
      const sections = {};
      document.querySelectorAll('.widget, .card, [class*="section"], .widgetHead').forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.length > 5 && text.length < 2000) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const header = lines[0];
          if (header && !sections[header]) {
            sections[header] = text;
          }
        }
      });

      // Name & Headline
      const name = getTxt('.user-name, .nI-gNb-drawer__bars, [class*="fullname"], h1') || getTxt('.title');
      
      // Let's find Resume Headline specifically
      let headline = null;
      let profileSummary = null;
      let keySkills = [];
      let noticePeriod = null;
      let totalExp = null;
      let currentSalary = null;
      let resumeName = null;

      // Scan all text nodes / blocks
      for (const [key, content] of Object.entries(sections)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('headline')) {
          headline = content;
        } else if (lowerKey.includes('summary')) {
          profileSummary = content;
        } else if (lowerKey.includes('skill')) {
          keySkills.push(content);
        } else if (lowerKey.includes('resume') && !lowerKey.includes('headline')) {
          resumeName = content;
        }
      }

      // Specific skill chips
      const chips = getAllTxt('.chip, .keySkills a, .tag, [class*="chip"]');
      if (chips.length > 0) {
        keySkills = chips;
      }

      // Quick info at the top
      const topInfo = getAllTxt('.quick-details span, .personal-details span, .info span, .mod-date, [class*="sub-title"]');

      return {
        name,
        headline,
        profileSummary,
        keySkills,
        resumeName,
        topInfo,
        allSections: sections
      };
    });

    console.log('\n--- EXTRACTED NAUKRI PROFILE SNAPSHOT ---');
    console.log('Candidate Name:', data.name);
    console.log('Current Headline Section:', data.headline);
    console.log('Current Summary Section:', data.profileSummary ? data.profileSummary.slice(0, 300) : 'None');
    console.log('Current Skills Extracted:', data.keySkills?.slice(0, 20));
    console.log('Top Info / Details:', data.topInfo);
    console.log('Resume Details:', data.resumeName);
    console.log('All Section Keys:', Object.keys(data.allSections));

    fs.writeFileSync('data/naukri_profile_snapshot.json', JSON.stringify(data, null, 2));
    console.log('\nSaved full snapshot to data/naukri_profile_snapshot.json');

  } catch (err) {
    console.error('Inspection error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

inspectProfile();
