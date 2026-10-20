import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Cleaning up DE & Distributed Control System and checking autocomplete...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    const keySkillsEdit = page.locator('span[aria-label="Edit key skills"]').first();
    await keySkillsEdit.click();
    await randomSleep(2000, 3000);

    // 1. Remove 'DE' and 'Distributed Control System'
    for (const badChip of ['DE', 'Distributed Control System']) {
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
      }, badChip);
      console.log(`Removal of "${badChip}":`, removed ? '✅ Removed' : '⚠️ Not found');
      await randomSleep(1000, 1500);
    }

    // 2. Test typing various candidate skills and log their EXACT suggestions
    const testKeywords = ['Maven', 'Design Patterns', 'System Design', 'Kafka', 'Multithreading', 'Spring Cloud', 'JPA'];
    const inputLocator = page.locator('input#keySkillSugg');

    for (const kw of testKeywords) {
      // Clear input
      await inputLocator.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await randomSleep(400, 600);

      // Type
      for (const ch of kw) {
        await page.keyboard.type(ch, { delay: 80 });
      }
      await randomSleep(1500, 2000);

      // Extract suggestions
      const suggs = await page.evaluate(() => {
        const list = Array.from(document.querySelectorAll('#sugLst_keySkillSugg li, .sug-layer li, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'))
          .map(el => el.innerText?.trim())
          .filter(Boolean);
        return list;
      });
      console.log(`Suggestions for "${kw}":`, suggs.slice(0, 6));

      // If 'Maven' has a good match, let's click 'Maven'
      if (kw === 'Maven' && suggs.some(s => s.toLowerCase() === 'maven')) {
        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('#sugLst_keySkillSugg li, .sug-layer li, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'));
          const item = items.find(el => el.innerText?.trim().toLowerCase() === 'maven');
          if (item) item.click();
        });
        console.log('✅ Added "Maven"!');
        await randomSleep(1200, 1800);
      }

      // If 'Spring Cloud' has a good match
      if (kw === 'Spring Cloud' && suggs.some(s => s.toLowerCase() === 'spring cloud')) {
        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('#sugLst_keySkillSugg li, .sug-layer li, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'));
          const item = items.find(el => el.innerText?.trim().toLowerCase() === 'spring cloud');
          if (item) item.click();
        });
        console.log('✅ Added "Spring Cloud"!');
        await randomSleep(1200, 1800);
      }
    }

    // Read current chips
    const currentChips = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.chipsContainer .chip .tagTxt'))
        .map(t => t.innerText?.trim())
        .filter(Boolean);
    });
    console.log('\nCurrent Chips before save:', currentChips);

    // Save
    const saved = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
        .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log('Save button clicked:', saved);
    await randomSleep(3500, 5000);

    // Save session state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('✅ Updated Key Skills saved!');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
