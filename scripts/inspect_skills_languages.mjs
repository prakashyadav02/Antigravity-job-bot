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

    // 1. Inspect Key Skills Edit
    console.log('Clicking: span[aria-label="Edit key skills"]');
    const skillsEdit = page.locator('span[aria-label="Edit key skills"]').first();
    await skillsEdit.click();
    await page.waitForTimeout(2000);

    const skillsDrawerInfo = await page.evaluate(() => {
      const modal = document.querySelector('.lightbox.model_open, .drawer, [class*="profileEditDrawer"]');
      const inputs = Array.from(modal?.querySelectorAll('input') || []).map(i => ({
        id: i.id,
        placeholder: i.placeholder,
        className: i.className
      }));
      const chips = Array.from(modal?.querySelectorAll('.chip, .tag, [class*="chip"]') || []).map(c => c.innerText?.trim());
      return { inputs, chipCount: chips.length, chipSample: chips.slice(0, 10) };
    });
    console.log('Skills Drawer Info:\n', skillsDrawerInfo);

    // Close skills modal
    const closeBtn = page.locator('.lightbox.model_open [class*="crossLayer"], .lightbox.model_open .crossLayer, .lightbox.model_open [class*="close"]').first();
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(1500);

    // 2. Scroll to Personal Details & Inspect Languages
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);

    console.log('Clicking: span[aria-label="Edit personal details"]');
    const personalEdit = page.locator('span[aria-label="Edit personal details"]').first();
    if (await personalEdit.isVisible({ timeout: 5000 })) {
      await personalEdit.click();
      await page.waitForTimeout(2000);

      const personalDrawerInfo = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, [class*="profileEditDrawer"]');
        return {
          title: modal?.querySelector('h1, h2, h3, .title, .heading')?.innerText?.trim(),
          textSnippet: modal?.innerText?.slice(0, 600)
        };
      });
      console.log('Personal Details Modal Info:\n', personalDrawerInfo);
    }

  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
