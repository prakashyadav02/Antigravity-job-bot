import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Inspecting IT Skill modal for Java & MySQL...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    const javaEdit = page.locator('span[aria-label="Edit IT skill: Java"]').first();
    const isVis = await javaEdit.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('span[aria-label="Edit IT skill: Java"] visible:', isVis);

    if (isVis) {
      await javaEdit.click();
      await randomSleep(2000, 3000);

      const modalInfo = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
        if (!modal) return null;
        return {
          title: modal.querySelector('.title, .heading, h3, h2')?.innerText?.trim(),
          inputs: Array.from(modal.querySelectorAll('input, select')).map(el => ({
            tag: el.tagName,
            id: el.id,
            name: el.name,
            value: el.value,
            placeholder: el.placeholder
          })),
          htmlSnippet: modal.innerHTML.slice(0, 1000)
        };
      });

      console.log('Java IT Skill Modal Info:', JSON.stringify(modalInfo, null, 2));
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
