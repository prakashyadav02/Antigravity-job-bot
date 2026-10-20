import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAUKRI_STORAGE = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function checkFresh() {
  const { browser, page } = await createBrowser({
    headless: true,
    storageState: NAUKRI_STORAGE
  });

  const freshUrl = 'https://www.naukri.com/data-engineer-jobs?experience=2&experience=3&experience=4&experience=5&sortBy=f';
  console.log('Navigating to:', freshUrl);
  await page.goto(freshUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const cards = await page.locator('.srp-jobtuple-wrapper').all();
  console.log('Found fresh cards count:', cards.length);

  for (let i = 0; i < Math.min(cards.length, 12); i++) {
    const title = (await cards[i].locator('.title').first().innerText().catch(() => '')).trim();
    const comp = (await cards[i].locator('.comp-name').first().innerText().catch(() => '')).trim();
    const exp = (await cards[i].locator('.exp, .exp-wrap').first().innerText().catch(() => '')).trim();
    const link = await cards[i].locator('.title').first().getAttribute('href').catch(() => '');
    const cardText = await cards[i].innerText().catch(() => '');
    const isCompanySite = cardText.toLowerCase().includes('company site');
    console.log(`[${i+1}] "${title}" @ ${comp} (${exp}) | CompSite: ${isCompanySite} | URL: ${link ? link.split('?')[0] : 'None'}`);
  }

  await browser.close();
}

checkFresh().catch(console.error);
