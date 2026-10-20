import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function inspectFullProfile() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Scroll down gradually to trigger lazy-loading of all sections
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(1000);
    }

    const fullDetails = await page.evaluate(() => {
      const result = {};

      // Name & Top Details
      result.basicInfo = {
        name: document.querySelector('.user-name, [class*="fullname"], h1')?.innerText?.trim(),
        title: document.querySelector('.sub-title, .designation')?.innerText?.trim(),
        experience: document.querySelector('.exp, [class*="experience"]')?.innerText?.trim(),
        salary: document.querySelector('.sal, [class*="salary"]')?.innerText?.trim(),
        location: document.querySelector('.loc, [class*="location"]')?.innerText?.trim(),
        noticePeriod: document.querySelector('.notice, [class*="notice"]')?.innerText?.trim(),
        phone: document.querySelector('.tel, [class*="phone"]')?.innerText?.trim(),
        email: document.querySelector('.email')?.innerText?.trim()
      };

      // Extract all section widgets
      document.querySelectorAll('.card, .widget').forEach(widget => {
        const title = widget.querySelector('.widgetHead, .heading, h2, h3, .title')?.innerText?.trim();
        const content = widget.innerText?.trim();
        if (title && content) {
          result[title] = content;
        }
      });

      return result;
    });

    console.log('Basic Info:', fullDetails.basicInfo);
    console.log('\nAll Section Titles Found:', Object.keys(fullDetails));
    
    fs.writeFileSync('data/naukri_full_details.json', JSON.stringify(fullDetails, null, 2));
    console.log('Saved to data/naukri_full_details.json');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

inspectFullProfile();
