import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Testing deletion of legacy junior project "Vogue"...');
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

      // Click delete button
      console.log('Clicking Delete in modal...');
      const deleteClicked = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
        if (!modal) return false;
        const del = modal.querySelector('a.delete, .delete');
        if (del) {
          del.click();
          return true;
        }
        return false;
      });
      console.log('Delete clicked:', deleteClicked);
      await randomSleep(1500, 2500);

      // Check for confirmation dialog or popup
      const confirmInfo = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('.confModal, .confirm-modal, .dialog, .lightbox.model_open, .alert, .popup, div[role="dialog"]'));
        const buttons = Array.from(document.querySelectorAll('button, a.btn, a'))
          .filter(b => b.offsetParent !== null && ['delete', 'yes', 'confirm', 'ok'].includes(b.innerText?.trim().toLowerCase()))
          .map(b => ({ text: b.innerText?.trim(), class: b.className }));
        return {
          dialogText: dialogs.map(d => d.innerText?.slice(0, 150).replace(/\s+/g, ' ')),
          confirmButtons: buttons
        };
      });

      console.log('Confirmation Info:', JSON.stringify(confirmInfo, null, 2));

      // Click confirm delete if button exists
      const confirmed = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a.btn, a'))
          .find(b => b.offsetParent !== null && ['delete', 'yes', 'confirm'].includes(b.innerText?.trim().toLowerCase()));
        if (btn) {
          btn.click();
          return btn.innerText?.trim();
        }
        return null;
      });
      console.log('Confirmed delete button clicked:', confirmed);
      await randomSleep(3500, 5000);

      await context.storageState({ path: STORAGE_STATE_PATH });
      console.log('✅ Vogue deletion cycle completed!');
    } else {
      console.log('Vogue project edit icon not found.');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
