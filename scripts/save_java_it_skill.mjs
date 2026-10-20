import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Setting Java version to 8,11,17 and clicking button#saveITSkills...');
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

    const versionInput = page.locator('input#version').first();
    await versionInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await randomSleep(300, 500);

    await page.keyboard.type('8,11,17', { delay: 100 });
    await randomSleep(800, 1200);

    // Dispatch input & change events
    await page.evaluate(() => {
      const inp = document.querySelector('input#version');
      if (inp) {
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await randomSleep(800, 1200);

    // Click button#saveITSkills directly
    console.log('Clicking button#saveITSkills...');
    await page.click('button#saveITSkills');
    await randomSleep(4000, 5000);

    // Verify row text in profile
    const javaRowText = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.card li.collection'));
      const row = rows.find(r => r.innerText?.includes('Java') && !r.innerText?.includes('JavaScript'));
      return row ? row.innerText?.replace(/\s+/g, ' ') : 'Java row not found';
    });
    console.log('Updated Java row text:', javaRowText);

    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('✅ Done!');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
