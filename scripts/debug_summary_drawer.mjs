import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function debugSummaryDrawer() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Scroll to profile summary
    const summaryWidget = page.locator('div:has-text("Profile summary") span.edit, [aria-label*="summary" i]').first();
    console.log('Clicking profile summary edit button...');
    await summaryWidget.click();
    await page.waitForTimeout(2500);

    const openElements = await page.evaluate(() => {
      const textareas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null).map(t => ({
        id: t.id,
        className: t.className,
        placeholder: t.placeholder,
        value: t.value.slice(0, 80)
      }));

      const visibleButtons = Array.from(document.querySelectorAll('.lightbox button, .drawer button, button.btn-dark-ot')).filter(b => b.offsetParent !== null).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim(),
        className: b.className
      }));

      const modals = Array.from(document.querySelectorAll('.lightbox, .drawer, [class*="profileEditDrawer"]')).filter(m => m.offsetParent !== null).map(m => ({
        className: m.className,
        textSnippet: m.innerText?.trim().slice(0, 150)
      }));

      return { textareas, visibleButtons, modals };
    });

    console.log('Visible Textareas in Summary Drawer:\n', openElements.textareas);
    console.log('Visible Modals:\n', openElements.modals);
    console.log('Visible Buttons in Modal:\n', openElements.visibleButtons);

  } finally {
    await browser.close().catch(() => {});
  }
}

debugSummaryDrawer();
