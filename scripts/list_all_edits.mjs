import { createBrowser } from '../src/automation/browser.js';

async function listEdits() {
  const { browser, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: 'data/naukri_storage_state.json'
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Scroll to load all sections
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(600);
    }

    const editList = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.widgetHead, .card, .widget').forEach(w => {
        const titleEl = w.querySelector('.widgetTitle, .heading, h2, h3, .title');
        const editEl = w.querySelector('.edit, .icon-edit, [aria-label*="edit" i]');
        if (titleEl && editEl) {
          items.push({
            title: titleEl.innerText?.trim(),
            ariaLabel: editEl.getAttribute('aria-label'),
            tag: editEl.tagName,
            classes: editEl.className
          });
        }
      });
      return items;
    });

    console.log('Editable Sections Detected:\n', editList);
  } finally {
    await browser.close().catch(() => {});
  }
}

listEdits();
