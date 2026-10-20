import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function debugDrawer() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    const editBtn = page.locator('span[aria-label="Edit resume headline"], .resumeHeadline .edit').first();
    console.log('Clicking: span[aria-label="Edit resume headline"]');
    await editBtn.click();
    await page.waitForTimeout(2500);

    const openElements = await page.evaluate(() => {
      // Find all textareas and buttons currently visible in the DOM
      const textareas = Array.from(document.querySelectorAll('textarea')).map(t => ({
        id: t.id,
        className: t.className,
        placeholder: t.placeholder,
        value: t.value.slice(0, 80),
        visible: t.offsetParent !== null
      }));

      const visibleButtons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).filter(b => b.offsetParent !== null).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim(),
        className: b.className
      }));

      const modals = Array.from(document.querySelectorAll('.drawer, .modal, .lightbox, [class*="drawer"], [class*="modal"], [class*="layer"]')).filter(m => m.offsetParent !== null).map(m => ({
        className: m.className,
        textSnippet: m.innerText?.trim().slice(0, 150)
      }));

      return { textareas, visibleButtons, modals };
    });

    console.log('Visible Textareas:\n', openElements.textareas);
    console.log('Visible Modals/Drawers:\n', openElements.modals);
    console.log('Visible Buttons:\n', openElements.visibleButtons);

  } finally {
    await browser.close().catch(() => {});
  }
}

debugDrawer();
