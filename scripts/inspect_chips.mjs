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

    const keySkillsEdit = page.locator('span[aria-label="Edit key skills"]').first();
    await keySkillsEdit.click();
    await randomSleep(2000, 3000);

    // Inspect the chips and their delete buttons
    const chipsData = await page.evaluate(() => {
      const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
      if (!modal) return null;

      const chips = Array.from(modal.querySelectorAll('.chip, .tag, [class*="chip"]')).map(c => ({
        tag: c.tagName,
        className: c.className,
        text: c.innerText?.trim(),
        html: c.outerHTML.slice(0, 150),
        hasCross: !!c.querySelector('i, span.cross, a, [class*="cross"], [class*="close"]')
      }));

      return chips;
    });

    console.log('Chips details:', JSON.stringify(chipsData.slice(0, 8), null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
