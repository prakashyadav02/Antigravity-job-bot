import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Cleaning FastFit from Projects & Work Samples, and adding Design Patterns/System Design...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    // =========================================================================
    // 1. DELETE FastFit-Fitness Helper FROM PROJECTS
    // =========================================================================
    console.log('\n--- Deleting FastFit from Projects ---');
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(200, 300);
    }
    await randomSleep(2000, 3000);

    const fastfitEdit = page.locator('span[aria-label*="Edit project"][aria-label*="FastFit"]').first();
    if (await fastfitEdit.isVisible({ timeout: 5000 }).catch(() => false)) {
      await fastfitEdit.click();
      await randomSleep(2000, 3000);

      await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
        const del = modal?.querySelector('a.delete, .delete');
        if (del) del.click();
      });
      await randomSleep(1500, 2500);

      // Confirm delete
      const deleted = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, a.btn, a'))
          .find(b => b.offsetParent !== null && ['delete', 'yes', 'confirm'].includes(b.innerText?.trim().toLowerCase()));
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      console.log('Deleted FastFit from Projects:', deleted);
      await randomSleep(3500, 4500);
    }

    // =========================================================================
    // 2. CLEAN WORK SAMPLES (Vogue & FastFit)
    // =========================================================================
    console.log('\n--- Checking Work Samples in Accomplishments ---');
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(200, 300);
    }
    await randomSleep(2000, 3000);

    // Look for work sample items Vogue and FastFit
    const workSamplesToDelete = ['Vogue', 'FastFit-Fitness Helper'];
    for (const wsName of workSamplesToDelete) {
      console.log(`Checking work sample: ${wsName}...`);
      const clickedEdit = await page.evaluate((name) => {
        const items = Array.from(document.querySelectorAll('.accomplishments .row, .accomplishments li, .accomplishments .collection-item, .accomplishments .collection'));
        for (const item of items) {
          if (item.innerText?.includes(name)) {
            const editBtn = item.querySelector('[aria-label*="Edit"], .edit, a.edit');
            if (editBtn) {
              editBtn.click();
              return true;
            }
          }
        }
        return false;
      }, wsName);

      if (clickedEdit) {
        console.log(`Clicked edit for work sample ${wsName}`);
        await randomSleep(2000, 3000);

        // Click delete inside modal
        await page.evaluate(() => {
          const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
          const del = modal?.querySelector('a.delete, .delete');
          if (del) del.click();
        });
        await randomSleep(1500, 2500);

        // Confirm
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button, a.btn, a'))
            .find(b => b.offsetParent !== null && ['delete', 'yes', 'confirm'].includes(b.innerText?.trim().toLowerCase()));
          if (btn) btn.click();
        });
        console.log(`Deleted work sample ${wsName}`);
        await randomSleep(3500, 4500);
      }
    }

    // =========================================================================
    // 3. ADD "Design Patterns" AND "System Design" TO KEY SKILLS
    // =========================================================================
    console.log('\n--- Adding "Design Patterns" & "System Design" to Key Skills ---');
    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await randomSleep(1500, 2500);

    const keySkillsEdit = page.locator('span[aria-label="Edit key skills"]').first();
    await keySkillsEdit.click();
    await randomSleep(2000, 3000);

    const inputLocator = page.locator('input#keySkillSugg');
    const skillsToAdd = ['Design Patterns', 'System Design'];

    for (const skill of skillsToAdd) {
      console.log(`Typing: ${skill}...`);
      await inputLocator.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await randomSleep(300, 500);

      for (const ch of skill) {
        await page.keyboard.type(ch, { delay: 70 });
      }
      await randomSleep(1500, 2000);

      // Click exact suggestion
      const added = await page.evaluate((target) => {
        const items = Array.from(document.querySelectorAll('#sugLst_keySkillSugg li, .sug-layer li, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'));
        const exact = items.find(el => el.innerText?.trim().toLowerCase() === target.toLowerCase());
        if (exact) {
          exact.click();
          return exact.innerText?.trim();
        }
        return null;
      }, skill);
      console.log(`Added skill chip: "${added}"`);
      await randomSleep(1500, 2500);
    }

    // Save key skills
    const saved = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
        .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log('Saved Key Skills:', saved);
    await randomSleep(3500, 5000);

    // Save final updated storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('✅ All cleanups and skill additions finished and session saved!');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
