import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 1000);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    const info = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card'));
      const itCard = cards.find(c => c.innerText?.includes('IT skills') && c.innerText?.includes('Last used'));
      const projCard = cards.find(c => c.innerText?.includes('Projects') && c.innerText?.includes('TrackoField'));

      return {
        itCardHtml: itCard ? itCard.outerHTML.slice(0, 2000) : 'Not found',
        projCardHtml: projCard ? projCard.outerHTML.slice(0, 2000) : 'Not found'
      };
    });

    console.log('IT Card HTML:\n', info.itCardHtml);
    console.log('\n====================================\n');
    console.log('Project Card HTML:\n', info.projCardHtml);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
