import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAUKRI_STORAGE = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function testCardDetection() {
  const { browser, page } = await createBrowser({
    headless: true,
    storageState: NAUKRI_STORAGE
  });

  await page.goto('https://www.naukri.com/pyspark-developer-jobs?experience=2&experience=3&experience=4&experience=5', { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const tuples = await page.locator('.srp-jobtuple-wrapper').all();
  console.log(`Discovered ${tuples.length} tuples on pyspark-developer-jobs.`);

  for (let i = 0; i < Math.min(tuples.length, 6); i++) {
    const title = (await tuples[i].locator('.title').first().innerText().catch(() => '')).trim();
    const comp = (await tuples[i].locator('.comp-name').first().innerText().catch(() => '')).trim();
    const link = (await tuples[i].locator('.title').first().getAttribute('href').catch(() => '')).split('?')[0];
    const fullText = await tuples[i].innerText().catch(() => '');
    const isCompanySite = /company site|apply on company/i.test(fullText);
    console.log(`[${i+1}] "${title}" @ ${comp} | CompSite: ${isCompanySite} | URL: ${link}`);
  }

  await browser.close();
}

testCardDetection().catch(console.error);
