import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 1000);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    // Find card with heading IT skills
    const details = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card'));
      const itCard = cards.find(c => c.innerText?.includes('IT skills') && c.innerText?.includes('Last used'));
      const projCard = cards.find(c => c.innerText?.includes('Projects') && c.innerText?.includes('TrackoField'));
      const pdCard = document.querySelector('.personalDetails.card');

      return {
        itSkills: itCard ? {
          rows: Array.from(itCard.querySelectorAll('tr, .row, tbody tr')).map(r => ({
            text: r.innerText?.trim().replace(/\s+/g, ' '),
            editButtons: Array.from(r.querySelectorAll('span, a, i, button'))
              .filter(el => el.className?.includes('edit') || el.getAttribute('aria-label')?.includes('Edit') || el.innerText?.includes('edit'))
              .map(el => ({ tag: el.tagName, class: el.className, ariaLabel: el.getAttribute('aria-label') }))
          }))
        } : null,
        projects: projCard ? {
          projectTitles: Array.from(projCard.querySelectorAll('.project-title, .title, strong, h3, h4, .heading'))
            .map(p => p.innerText?.trim())
            .filter(Boolean),
          editButtons: Array.from(projCard.querySelectorAll('span, a, i, button'))
            .filter(el => el.className?.includes('edit') || el.getAttribute('aria-label')?.includes('Edit') || el.innerText?.includes('edit'))
            .map(el => ({ tag: el.tagName, class: el.className, ariaLabel: el.getAttribute('aria-label') }))
        } : null,
        personalDetails: pdCard ? {
          languagesText: pdCard.querySelector('.languages, [class*="language"], [data-section*="lang"]')?.innerText || pdCard.innerText.slice(pdCard.innerText.indexOf('Languages'))
        } : null
      };
    });

    console.log('Detailed Inspection:', JSON.stringify(details, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
