import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Updating IT Skills: Java (8, 11, 17) & MySQL (2026)...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    // =========================================================================
    // 1. UPDATE JAVA IT SKILL TO INCLUDE 17
    // =========================================================================
    console.log('\n--- Updating Java IT Skill ---');
    const javaEdit = page.locator('span[aria-label="Edit IT skill: Java"]').first();
    if (await javaEdit.isVisible({ timeout: 5000 }).catch(() => false)) {
      await javaEdit.click();
      await randomSleep(2000, 3000);

      const versionInput = page.locator('input#version').first();
      await versionInput.waitFor({ state: 'visible', timeout: 5000 });
      await versionInput.click();
      await versionInput.fill('8, 11, 17');
      console.log('✅ Set Java version to "8, 11, 17"');
      await randomSleep(1000, 1500);

      const javaSaved = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
          .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      console.log('💾 Java Save button clicked:', javaSaved);
      await randomSleep(3500, 4500);
    }

    // =========================================================================
    // 2. UPDATE MYSQL IT SKILL TO LAST USED 2026
    // =========================================================================
    console.log('\n--- Updating MySQL IT Skill ---');
    const mysqlEdit = page.locator('span[aria-label="Edit IT skill: MySQL"]').first();
    if (await mysqlEdit.isVisible({ timeout: 5000 }).catch(() => false)) {
      await mysqlEdit.click();
      await randomSleep(2000, 3000);

      // Check current last used
      const curYear = await page.locator('input#lastUsedDroopeFor').first().inputValue().catch(() => '');
      console.log('Current MySQL last used year:', curYear);

      if (curYear !== '2026') {
        await page.click('input#lastUsedDroopeFor');
        await randomSleep(800, 1200);

        // Click 2026 option from dropdown
        const clickedYear = await page.evaluate(() => {
          const list = Array.from(document.querySelectorAll('.droope-container li, .droopeList li, ul.dropdown-content li, li a, li span'))
            .find(el => el.innerText?.trim() === '2026' && el.offsetParent !== null);
          if (list) {
            list.click();
            return true;
          }
          return false;
        });
        console.log('Selected 2026 for MySQL:', clickedYear);
        await randomSleep(1000, 1500);

        const mysqlSaved = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
            .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        console.log('💾 MySQL Save button clicked:', mysqlSaved);
        await randomSleep(3500, 4500);
      } else {
        console.log('MySQL is already 2026.');
        await page.keyboard.press('Escape');
      }
    }

    // =========================================================================
    // 3. INSPECT PROJECTS SECTION & WORK SAMPLES
    // =========================================================================
    console.log('\n--- Inspecting Projects & Accomplishments Work Samples ---');
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    const projectsInfo = await page.evaluate(() => {
      // Find all edit or delete icons for projects
      const projEdits = Array.from(document.querySelectorAll('[aria-label*="project"], [aria-label*="Project"], .project-desc, .project-list'))
        .map(el => ({
          tag: el.tagName,
          label: el.getAttribute('aria-label'),
          class: el.className,
          text: el.innerText?.slice(0, 100).replace(/\s+/g, ' ')
        }));

      // Find all edit icons in accomplishments
      const accEdits = Array.from(document.querySelectorAll('.accomplishments [aria-label*="Edit"], .accomplishments .edit'))
        .map(el => ({
          tag: el.tagName,
          label: el.getAttribute('aria-label'),
          parentText: el.parentElement?.innerText?.slice(0, 100).replace(/\s+/g, ' ')
        }));

      return { projEdits, accEdits };
    });

    console.log('Projects & Work Samples edit targets:', JSON.stringify(projectsInfo, null, 2));

    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('✅ IT Skills updated and session saved!');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
