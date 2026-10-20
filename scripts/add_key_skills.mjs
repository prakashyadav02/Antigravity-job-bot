import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

const SKILLS_TO_ADD = [
  'Multithreading',
  'Distributed Systems',
  'Design Patterns',
  'Low Level Design',
  'System Design',
  'Maven'
];

async function main() {
  console.log('🚀 Adding Key Skills to Naukri.com...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    const keySkillsEdit = page.locator('span[aria-label="Edit key skills"]').first();
    await keySkillsEdit.waitFor({ state: 'visible', timeout: 8000 });
    await keySkillsEdit.click();
    await randomSleep(2000, 3000);

    const inputLocator = page.locator('input#keySkillSugg');
    await inputLocator.waitFor({ state: 'visible', timeout: 5000 });

    for (const skill of SKILLS_TO_ADD) {
      console.log(`\nTyping skill: ${skill}`);
      await inputLocator.focus();
      await inputLocator.fill('');
      await randomSleep(300, 500);

      // Type skill slowly like human
      for (const char of skill) {
        await inputLocator.type(char, { delay: 60 });
      }
      await randomSleep(1500, 2000);

      // Check if suggestion dropdown appeared
      const suggestions = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.sug-layer li, .sug-layer div, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'));
        return items.map(el => ({
          text: el.innerText?.trim(),
          visible: el.offsetParent !== null
        })).filter(x => x.text && x.visible);
      });

      console.log(`Suggestions for "${skill}":`, suggestions.map(s => s.text).slice(0, 5));

      if (suggestions.length > 0) {
        // Click the first matching suggestion or first suggestion
        const clicked = await page.evaluate((skillName) => {
          const items = Array.from(document.querySelectorAll('.sug-layer li, .sug-layer div, .sugCont li, .sugInpCont li, .matchBox li, .tuple, .sug-item'))
            .filter(el => el.offsetParent !== null && el.innerText?.trim());
          
          const match = items.find(el => el.innerText.trim().toLowerCase() === skillName.toLowerCase()) || items[0];
          if (match) {
            match.click();
            return match.innerText.trim();
          }
          return null;
        }, skill);

        console.log(`Clicked suggestion: ${clicked}`);
      } else {
        // Fallback: press Enter
        console.log('No dropdown visible, pressing Enter...');
        await inputLocator.press('Enter');
      }

      await randomSleep(1500, 2500);
    }

    // Check updated chips list
    const currentChips = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.chip, .tag, .sug-tag, .chip-container span, .chipWrap span, .chipCont span'))
        .map(c => c.innerText?.trim())
        .filter(Boolean);
      return chips;
    });
    console.log('\nUpdated Chips in modal:', currentChips);

    // Save
    console.log('\nSaving Key Skills...');
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
    await randomSleep(4000, 5000);

    // Update storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('✅ Key Skills updated successfully and session saved!');

  } catch (err) {
    console.error('Error during key skills update:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
