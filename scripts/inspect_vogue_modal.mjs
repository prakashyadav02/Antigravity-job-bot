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

    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(200, 400);
    }
    await randomSleep(2000, 3000);

    const vogueEdit = page.locator('span[aria-label="Edit project: Vogue"]').first();
    if (await vogueEdit.isVisible({ timeout: 5000 }).catch(() => false)) {
      await vogueEdit.click();
      await randomSleep(2000, 3000);

      const modalInfo = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
        if (!modal) return null;
        return {
          title: modal.querySelector('.title, .heading, h3, h2, .widgetTitle')?.innerText?.trim(),
          deleteBtn: Array.from(modal.querySelectorAll('.delete, [class*="delete"], a, span, button'))
            .filter(el => el.innerText?.toLowerCase().includes('delete') || el.getAttribute('aria-label')?.toLowerCase().includes('delete'))
            .map(el => ({ tag: el.tagName, class: el.className, text: el.innerText?.trim(), ariaLabel: el.getAttribute('aria-label') }))
        };
      });

      console.log('Vogue Project Modal:', JSON.stringify(modalInfo, null, 2));
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
