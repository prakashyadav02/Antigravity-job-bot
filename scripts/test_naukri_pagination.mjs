import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAUKRI_STORAGE = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function testPagination() {
  const { browser, page } = await createBrowser({
    headless: true,
    storageState: NAUKRI_STORAGE
  });

  const urlsToTest = [
    'https://www.naukri.com/data-engineer-jobs-2?experience=2&experience=3&experience=4&experience=5',
    'https://www.naukri.com/pyspark-developer-jobs?experience=2&experience=3&experience=4&experience=5',
    'https://www.naukri.com/spark-data-engineer-jobs?experience=2&experience=3&experience=4&experience=5',
    'https://www.naukri.com/databricks-jobs?experience=2&experience=3&experience=4&experience=5'
  ];

  for (const url of urlsToTest) {
    console.log('\nTesting URL:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);

    const cards = await page.locator('.srp-jobtuple-wrapper').all();
    console.log(`Discovered ${cards.length} cards.`);

    for (let i = 0; i < Math.min(cards.length, 5); i++) {
      const title = (await cards[i].locator('.title').first().innerText().catch(() => '')).trim();
      const comp = (await cards[i].locator('.comp-name').first().innerText().catch(() => '')).trim();
      const link = await cards[i].locator('.title').first().getAttribute('href').catch(() => '');
      console.log(`   [${i+1}] "${title}" @ ${comp} -> ${link ? link.split('?')[0] : 'None'}`);
    }
  }

  await browser.close();
}

testPagination().catch(console.error);
