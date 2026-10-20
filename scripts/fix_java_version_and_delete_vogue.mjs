import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Fixing Java version to "8, 11, 17" and cleanly removing legacy projects...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    // =========================================================================
    // 1. UPDATE JAVA IT SKILL VERSION
    // =========================================================================
    console.log('\n--- [Step 1] Updating Java Version in IT Skills ---');
    for (let i = 0; i < 7; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(200, 300);
    }
    await randomSleep(2000, 3000);

    const javaEdit = page.locator('span[aria-label="Edit IT skill: Java"]').first();
    if (await javaEdit.isVisible({ timeout: 5000 }).catch(() => false)) {
      await javaEdit.click();
      await randomSleep(2000, 3000);

      const versionInput = page.locator('input#version').first();
      await versionInput.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await randomSleep(300, 500);

      for (const ch of '8, 11, 17') {
        await page.keyboard.type(ch, { delay: 80 });
      }
      await randomSleep(800, 1200);

      // Trigger change/input event
      await page.evaluate(() => {
        const inp = document.querySelector('input#version');
        if (inp) {
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await randomSleep(800, 1200);

      // Click Save
      const javaSaved = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
        const btn = Array.from(modal.querySelectorAll('button'))
          .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      console.log('💾 Java IT skill Save clicked:', javaSaved);
      await randomSleep(3500, 4500);
    }

    // =========================================================================
    // 2. DELETE VOGUE & FASTFIT FROM PROJECTS
    // =========================================================================
    console.log('\n--- [Step 2] Deleting Legacy Projects (Vogue, FastFit) ---');
    for (const projTitle of ['Vogue', 'FastFit-Fitness Helper']) {
      console.log(`Searching for project "${projTitle}"...`);
      const editBtn = page.locator(`span[aria-label*="Edit project"][aria-label*="${projTitle}"]`).first();
      if (await editBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await editBtn.click();
        await randomSleep(2000, 3000);

        // Click delete link in header
        console.log(`Clicking Delete header link for ${projTitle}...`);
        await page.evaluate(() => {
          const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
          const del = modal?.querySelector('a.delete, .delete');
          if (del) del.click();
        });
        await randomSleep(1500, 2500);

        // Click confirmation button (.btn-dark-ot inside confirm dialog)
        const confirmed = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button.btn-dark-ot, .confModal button, .confirm-modal button'))
            .filter(b => b.offsetParent !== null && b.innerText?.trim().toLowerCase().includes('delete'));
          if (btns.length > 0) {
            btns[btns.length - 1].click(); // click the actual confirmation button
            return true;
          }
          return false;
        });
        console.log(`Confirmed delete of ${projTitle}:`, confirmed);
        await randomSleep(4000, 5000);
      } else {
        console.log(`Project "${projTitle}" not found or already deleted.`);
      }
    }

    // Save final updated storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('✅ Changes applied and session saved!');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
