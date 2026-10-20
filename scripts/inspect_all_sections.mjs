import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function main() {
  console.log('🚀 Inspecting IT Skills and Projects lazy load elements...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    // Scroll progressively all the way down to bottom
    console.log('Progressively scrolling to bottom of profile...');
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 1000);
      await randomSleep(400, 600);
    }
    await randomSleep(3000, 4000);

    // Find all sections or cards
    const allSections = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card, .widget, [data-section], section, .section'));
      return cards.map(c => ({
        id: c.id,
        className: c.className,
        heading: c.querySelector('h2, h3, .heading, .widgetHead, .title')?.innerText?.trim() || '',
        textSnippet: c.innerText?.slice(0, 100).replace(/\s+/g, ' ')
      })).filter(c => c.heading || c.textSnippet);
    });

    console.log('All profile sections found:', JSON.stringify(allSections, null, 2));

    // Specifically search for "IT skills" heading or element
    const itSkillsEl = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const match = allElements.find(el => el.innerText?.trim() === 'IT skills' && el.offsetParent !== null);
      if (!match) return null;
      const card = match.closest('.card, .widget, section') || match.parentElement?.parentElement;
      return {
        tag: match.tagName,
        cardTag: card?.tagName,
        cardClass: card?.className,
        cardId: card?.id,
        cardHtml: card?.innerHTML?.slice(0, 600)
      };
    });

    console.log('\nIT Skills Element:', JSON.stringify(itSkillsEl, null, 2));

    // Also look for Projects element
    const projectsEl = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('*'));
      const match = allElements.find(el => el.innerText?.trim() === 'Projects' && el.offsetParent !== null);
      if (!match) return null;
      const card = match.closest('.card, .widget, section') || match.parentElement?.parentElement;
      return {
        tag: match.tagName,
        cardTag: card?.tagName,
        cardClass: card?.className,
        cardId: card?.id,
        cardHtml: card?.innerHTML?.slice(0, 600)
      };
    });

    console.log('\nProjects Element:', JSON.stringify(projectsEl, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
