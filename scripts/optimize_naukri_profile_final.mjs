import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

const SKILLS_TO_REMOVE = [
  'Code Quality',
  'Cron',
  'Agile Methodologies',
  'Gradle'
];

const SKILLS_TO_ADD = [
  'Multithreading',
  'Distributed Systems',
  'Design Patterns',
  'Low Level Design'
];

async function main() {
  console.log('🚀 Starting Profile Optimization (Key Skills, IT Skills, Languages)...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    const title = await page.title();
    console.log('Page Title:', title);
    if (page.url().includes('/nlogin') || page.url().includes('/login')) {
      console.error('❌ Session expired or not logged in.');
      return;
    }

    // =========================================================================
    // 1. UPDATE KEY SKILLS
    // =========================================================================
    console.log('\n--- [Step 1] Updating Key Skills ---');
    const keySkillsEdit = page.locator('span[aria-label="Edit key skills"]').first();
    await keySkillsEdit.waitFor({ state: 'visible', timeout: 8000 });
    await keySkillsEdit.click();
    await randomSleep(2000, 3000);

    // Remove obsolete/filler chips
    for (const skillToRemove of SKILLS_TO_REMOVE) {
      const removed = await page.evaluate((name) => {
        const chips = Array.from(document.querySelectorAll('.chipsContainer .chip'));
        for (const chip of chips) {
          const txt = chip.querySelector('.tagTxt')?.innerText?.trim();
          if (txt && txt.toLowerCase() === name.toLowerCase()) {
            const closeBtn = chip.querySelector('a.close');
            if (closeBtn) {
              closeBtn.click();
              return true;
            }
          }
        }
        return false;
      }, skillToRemove);

      console.log(`Removal of "${skillToRemove}":`, removed ? '✅ Removed' : '⚠️ Not found');
      await randomSleep(800, 1500);
    }

    // Check input maxlength now
    const inputState = await page.evaluate(() => {
      const inp = document.querySelector('input#keySkillSugg');
      return inp ? { maxlength: inp.getAttribute('maxlength'), placeholder: inp.placeholder } : null;
    });
    console.log('Input state after removals:', inputState);

    // Add new skills
    const inputLocator = page.locator('input#keySkillSugg');
    for (const skillToAdd of SKILLS_TO_ADD) {
      console.log(`\nAdding skill: "${skillToAdd}"...`);
      await inputLocator.click();
      await inputLocator.fill('');
      await randomSleep(300, 500);

      // Type skill slowly
      for (const char of skillToAdd) {
        await page.keyboard.type(char, { delay: 70 });
      }
      await randomSleep(1500, 2500);

      // Look for autocomplete suggestions
      const suggestions = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('#sugLst_keySkillSugg li, .sug-layer li, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'))
          .map(el => el.innerText?.trim())
          .filter(Boolean);
        return items;
      });
      console.log(`Suggestions for "${skillToAdd}":`, suggestions.slice(0, 5));

      if (suggestions.length > 0) {
        const clicked = await page.evaluate((target) => {
          const items = Array.from(document.querySelectorAll('#sugLst_keySkillSugg li, .sug-layer li, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'));
          const exact = items.find(el => el.innerText?.trim().toLowerCase() === target.toLowerCase()) || items[0];
          if (exact) {
            exact.click();
            return exact.innerText?.trim();
          }
          return null;
        }, skillToAdd);
        console.log(`Clicked suggestion: "${clicked}"`);
      } else {
        console.log('No suggestion dropdown found, pressing Enter...');
        await page.keyboard.press('Enter');
      }

      await randomSleep(1500, 2500);
    }

    // Read all chips before saving
    const finalChips = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.chipsContainer .chip .tagTxt'))
        .map(t => t.innerText?.trim())
        .filter(Boolean);
    });
    console.log('\nFinal Key Skills chips in modal:', finalChips);

    // Save Key Skills
    const keySkillsSaved = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
        .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log('💾 Key Skills Save button clicked:', keySkillsSaved);
    await randomSleep(4000, 5000);

    // =========================================================================
    // 2. SCROLL DOWN TO IT SKILLS
    // =========================================================================
    console.log('\n--- [Step 2] Scrolling to IT Skills ---');
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(600, 1000);
    }
    await randomSleep(2000, 3000);

    // Look for IT Skills edit icons
    const itSkillsRows = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.it-skills tr, .itSkills tr, [data-section="itSkills"] tr, table tr'));
      return rows.map((r, idx) => ({
        idx,
        text: r.innerText?.trim().replace(/\s+/g, ' '),
        hasEdit: !!r.querySelector('span[aria-label*="Edit"], .edit, a.edit, i.edit')
      })).filter(r => r.text && r.text.length > 5);
    });
    console.log('Detected IT skills rows:', JSON.stringify(itSkillsRows.slice(0, 12), null, 2));

    // Look specifically for Java edit
    const javaEditSelector = 'span[aria-label="Edit IT skill: Java"], span[aria-label*="Edit"][aria-label*="Java"]';
    const javaEdit = page.locator(javaEditSelector).first();
    const hasJavaEdit = await javaEdit.isVisible({ timeout: 4000 }).catch(() => false);
    console.log('Java edit button visible by aria-label:', hasJavaEdit);

    if (hasJavaEdit) {
      await javaEdit.click();
      await randomSleep(2000, 3000);

      // Inspect the IT skill edit modal
      const modalInfo = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
        if (!modal) return null;
        const inputs = Array.from(modal.querySelectorAll('input, select')).map(el => ({
          tag: el.tagName,
          id: el.id,
          name: el.name,
          value: el.value,
          placeholder: el.placeholder
        }));
        return { inputs };
      });
      console.log('Java IT Skill edit form:', JSON.stringify(modalInfo, null, 2));

      // Try updating version to include 17
      const versionInput = page.locator('.lightbox.model_open input[name="version"], .lightbox.model_open input#version, input[placeholder*="version"]').first();
      if (await versionInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        const curVal = await versionInput.inputValue();
        console.log('Current Java version value:', curVal);
        if (!curVal.includes('17')) {
          const newVal = curVal ? `${curVal}, 17` : '8, 11, 17';
          await versionInput.fill(newVal);
          console.log(`Updated Java version to: "${newVal}"`);
          await randomSleep(1000, 1500);

          // Click Save
          const itSaved = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
              .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
            if (btn) {
              btn.click();
              return true;
            }
            return false;
          });
          console.log('💾 Java IT Skill Save button clicked:', itSaved);
          await randomSleep(3500, 4500);
        } else {
          console.log('Java 17 already in version!');
          // Close modal
          await page.keyboard.press('Escape');
        }
      }
    }

    // =========================================================================
    // 3. CHECK PERSONAL DETAILS (ENGLISH PROFICIENCY)
    // =========================================================================
    console.log('\n--- [Step 3] Checking Personal Details / Languages ---');
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(600, 1000);
    }
    await randomSleep(2000, 3000);

    const langInfo = await page.evaluate(() => {
      const sec = document.querySelector('[data-section="personalDetails"], .personal-details, .languages, #lazyPersonalDetails');
      return sec ? sec.innerText?.replace(/\s+/g, ' ').slice(0, 400) : 'Section not found';
    });
    console.log('Language & Personal details snippet:', langInfo);

    // Save final updated storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('\n✨ Finished all optimizations and saved session state!');

  } catch (err) {
    console.error('Execution error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
