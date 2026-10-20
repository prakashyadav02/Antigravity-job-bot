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

    for (let i = 0; i < 7; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(200, 300);
    }
    await randomSleep(2000, 3000);

    const javaEdit = page.locator('span[aria-label="Edit IT skill: Java"]').first();
    await javaEdit.click();
    await randomSleep(2000, 3000);

    const formDetails = await page.evaluate(() => {
      const form = document.querySelector('#itSkillsForm');
      if (!form) return null;
      const allActionEls = Array.from(form.querySelectorAll('button, a, input[type="submit"], input[type="button"]'))
        .map(el => ({
          tag: el.tagName,
          id: el.id,
          type: el.type,
          className: el.className,
          text: el.innerText?.trim() || el.value
        }));
      return { allActionEls };
    });

    console.log('Action elements in #itSkillsForm:', JSON.stringify(formDetails, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
