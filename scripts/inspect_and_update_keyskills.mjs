import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Connecting to Naukri.com to inspect & update Key Skills...');
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

    // Locate Key skills section
    console.log('\n--- Checking Key Skills Section ---');
    const keySkillsEdit = page.locator('span[aria-label="Edit key skills"]').first();
    const editExists = await keySkillsEdit.isVisible({ timeout: 8000 }).catch(() => false);
    console.log('Key skills edit button visible:', editExists);

    if (!editExists) {
      // Try finding by text or icon
      console.log('Looking for Key skills edit container...');
      const altEdit = page.locator('.key-skills .edit, .widgetHead:has-text("Key skills") .edit, [data-section="keySkills"] .edit').first();
      console.log('Alt edit visible:', await altEdit.isVisible().catch(() => false));
    }

    if (editExists) {
      await keySkillsEdit.click();
      await randomSleep(2000, 3000);

      // Inspect drawer or lightbox content
      const modalInfo = await page.evaluate(() => {
        const modal = document.querySelector('.lightbox.model_open, .drawer, .modal');
        if (!modal) return { open: false };
        const inputs = Array.from(modal.querySelectorAll('input')).map(i => ({
          id: i.id,
          placeholder: i.placeholder,
          className: i.className,
          type: i.type
        }));
        const chips = Array.from(modal.querySelectorAll('.chip, .tag, .sug-tag, .chip-container span, .chipWrap span')).map(c => c.innerText?.trim()).filter(Boolean);
        const buttons = Array.from(modal.querySelectorAll('button')).map(b => ({
          text: b.innerText?.trim(),
          className: b.className
        }));
        return {
          open: true,
          inputs,
          chips: chips.slice(0, 30),
          buttons
        };
      });

      console.log('Modal info:', JSON.stringify(modalInfo, null, 2));
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
