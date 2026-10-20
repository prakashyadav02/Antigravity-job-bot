import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Connecting to inspect & update IT Skills (Java 17, MySQL 2026)...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    // Scroll down to IT skills section
    console.log('Scrolling down to IT skills...');
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(600, 1000);
    }
    await randomSleep(2000, 3000);

    // Inspect IT skills rows and edit buttons
    const itSkillsData = await page.evaluate(() => {
      const container = document.querySelector('[data-section="itSkills"], .it-skills, #lazyItSkills, .itSkills');
      if (!container) return { found: false, htmlSnippet: document.body.innerText.slice(0, 500) };

      const rows = Array.from(container.querySelectorAll('table tr, .table-row, .row, .skill-row, li')).map(r => ({
        text: r.innerText?.trim().replace(/\s+/g, ' '),
        hasEdit: !!r.querySelector('span[aria-label*="Edit"], .edit, a.edit')
      }));

      return {
        found: true,
        rows
      };
    });

    console.log('IT skills container check:', JSON.stringify(itSkillsData, null, 2));

  } catch (err) {
    console.error('Error in IT skills update:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
