import { createBrowser } from '../src/automation/browser.js';

async function main() {
  const { browser, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: 'data/naukri_storage_state.json'
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    const editBtn = page.locator('span[aria-label="Edit profile summary"]').first();
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click();
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
      const ta = document.querySelector('.lightbox textarea, .drawer textarea, textarea');
      const saveBtn = document.querySelector('.lightbox button.btn-dark-ot, .drawer button.btn-dark-ot, button.btn-dark-ot');
      return {
        textareaId: ta?.id,
        textareaClass: ta?.className,
        textareaPlaceholder: ta?.placeholder,
        textareaValue: ta?.value?.slice(0, 100),
        saveBtnText: saveBtn?.innerText?.trim(),
        saveBtnClass: saveBtn?.className
      };
    });

    console.log('Profile Summary Drawer Info:\n', info);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
