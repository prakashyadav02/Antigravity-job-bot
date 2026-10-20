import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');
const OUTPUT_FILE = path.resolve(__dirname, '../data/naukri_full_details_updated.json');

async function main() {
  console.log('🚀 Fetching updated full snapshot of Vivek\'s Naukri Profile...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    // Progressive scroll to load all dynamic React sections
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 1000);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    const profileData = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card, .widget, [data-section]'));
      const result = {};

      for (const card of cards) {
        const titleEl = card.querySelector('h2, h3, .heading, .widgetHead, .title');
        const title = titleEl ? titleEl.innerText?.trim() : 'card_' + Math.random().toString(36).substr(2, 5);
        result[title] = card.innerText?.trim();
      }

      return result;
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profileData, null, 2), 'utf-8');
    console.log(`✅ Updated profile saved to ${OUTPUT_FILE}`);

    // Print summary of critical sections
    console.log('\n--- HEADLINE ---');
    console.log(profileData['Resume headline\neditOneTheme'] || profileData['Resume headline']);

    console.log('\n--- KEY SKILLS ---');
    console.log(profileData['Key skills\neditOneTheme'] || profileData['Key skills']);

    console.log('\n--- IT SKILLS ---');
    console.log(profileData['IT skills']);

    console.log('\n--- PROJECTS ---');
    console.log(profileData['Projects\nAdd project'] || profileData['Projects']);

    console.log('\n--- PROFILE SUMMARY ---');
    console.log(profileData['Profile summary\neditOneTheme'] || profileData['Profile summary']);

    await context.storageState({ path: STORAGE_STATE_PATH });

  } catch (err) {
    console.error('Error fetching profile:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
