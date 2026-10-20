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

    // Let's click the input and see its attributes and surrounding markup
    const inputDetails = await page.evaluate(() => {
      const inp = document.querySelector('input#keySkillSugg');
      if (!inp) return null;
      return {
        id: inp.id,
        className: inp.className,
        outerHTML: inp.outerHTML,
        parentHTML: inp.parentElement?.outerHTML
      };
    });
    console.log('Input details:', inputDetails);

    // Try typing with page.keyboard instead of locator.type or see if there is an event
    await page.click('input#keySkillSugg');
    await randomSleep(500, 800);
    await page.keyboard.type('Multithreading', { delay: 100 });
    await randomSleep(2000, 3000);

    // Check all elements added to DOM or visible dropdowns
    const dropdownInfo = await page.evaluate(() => {
      const allVisibleDivs = Array.from(document.querySelectorAll('div, ul, li, span'))
        .filter(el => {
          const text = el.innerText?.toLowerCase() || '';
          return text.includes('multithreading') && el.offsetParent !== null;
        })
        .map(el => ({
          tag: el.tagName,
          className: el.className,
          id: el.id,
          text: el.innerText.slice(0, 80)
        }));
      return allVisibleDivs;
    });

    console.log('Elements matching "multithreading":', dropdownInfo);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
