import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function debugHeadline() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Click edit on Resume Headline
    const editBtn = page.locator('.resumeHeadline .edit, [class*="resumeHeadline"] [class*="edit"], .widgetHead:has-text("Resume headline") .edit, span:has-text("edit")').first();
    console.log('Clicking edit button...');
    await editBtn.click();
    await page.waitForTimeout(2000);

    const buttonsInfo = await page.evaluate(() => {
      // Find all buttons inside or near the headline widget
      const widget = document.querySelector('.resumeHeadline, [class*="resumeHeadline"]');
      const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn, .btn'));
      return {
        widgetHtml: widget ? widget.innerHTML.slice(0, 1000) : 'No widget found',
        buttons: allButtons.map(b => ({
          tag: b.tagName,
          text: b.innerText?.trim(),
          classes: b.className,
          type: b.type,
          visible: b.offsetParent !== null
        })).filter(b => b.text && (b.text.toLowerCase().includes('save') || b.text.toLowerCase().includes('cancel')))
      };
    });

    console.log('Buttons near form:', buttonsInfo.buttons);
    console.log('\nWidget HTML snippet:\n', buttonsInfo.widgetHtml);

  } finally {
    await browser.close().catch(() => {});
  }
}

debugHeadline();
