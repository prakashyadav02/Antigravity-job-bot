import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('Connecting to Naukri with saved session...');
  const { browser, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    // Scroll down to load all components
    for (let i = 0; i < 7; i++) {
      await page.mouse.wheel(0, 1000);
      await randomSleep(600, 800);
    }
    await randomSleep(2000, 3000);

    // 1. Inspect Personal Details Edit
    console.log('\n--- Inspecting Personal Details Edit ---');
    const personalEdit = page.locator('span[aria-label="Edit personal details"]').first();
    if (await personalEdit.isVisible({ timeout: 5000 })) {
      await personalEdit.click();
      await randomSleep(2500, 3500);

      const personalForm = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, [class*="profileEditDrawer"]');
        if (!modal) return 'No modal found';
        
        // Find language related elements
        const labels = Array.from(modal.querySelectorAll('label, .label, span, div')).map(e => e.innerText?.trim()).filter(Boolean);
        const inputs = Array.from(modal.querySelectorAll('input, select')).map(i => ({
          tag: i.tagName,
          name: i.name,
          id: i.id,
          type: i.type,
          value: i.value,
          checked: i.checked
        }));

        return {
          title: modal.querySelector('h1, h2, h3, .title, .heading')?.innerText?.trim(),
          textSnippet: modal.innerText.slice(0, 1500),
          inputs
        };
      });

      console.log('Personal Form Info:\n', personalForm);

      // Close modal
      const closeBtn = page.locator('.lightbox.model_open .crossLayer, .lightbox.model_open [class*="close"], .lightbox.model_open button:has-text("Cancel")').first();
      await closeBtn.click().catch(() => {});
      await randomSleep(2000, 3000);
    }

    // 2. Inspect IT Skills Edit for MySQL
    console.log('\n--- Inspecting IT Skills Edit ---');
    const mysqlEdit = page.locator('[aria-label*="MySQL" i], tr:has-text("MySQL") .edit, div:has-text("MySQL") .edit').first();
    if (await mysqlEdit.isVisible({ timeout: 5000 })) {
      console.log('Found MySQL edit icon. Clicking...');
      await mysqlEdit.click();
      await randomSleep(2500, 3500);

      const itSkillForm = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, [class*="profileEditDrawer"]');
        if (!modal) return 'No modal found';
        return {
          textSnippet: modal.innerText.slice(0, 1000),
          inputs: Array.from(modal.querySelectorAll('input, select')).map(i => ({
            tag: i.tagName,
            name: i.name,
            id: i.id,
            type: i.type,
            value: i.value
          }))
        };
      });

      console.log('IT Skill Form Info:\n', itSkillForm);
      const closeBtn = page.locator('.lightbox.model_open .crossLayer, .lightbox.model_open [class*="close"], .lightbox.model_open button:has-text("Cancel")').first();
      await closeBtn.click().catch(() => {});
    }

  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
