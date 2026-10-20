import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/linkedin_storage_state.json');
const OUTPUT_PATH = path.resolve(__dirname, '../data/linkedin_full_details.json');

async function main() {
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    console.error('❌ LinkedIn session not found. Please run `node scripts/login_linkedin.mjs` first!');
    return;
  }

  console.log('🚀 Connecting to LinkedIn with saved session...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    const title = await page.title();
    console.log('Page Title:', title);
    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      console.error('❌ LinkedIn session expired or requires login.');
      return;
    }

    // Scroll down to trigger lazy sections
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(400, 600);
    }
    await randomSleep(2000, 3000);

    const data = await page.evaluate(() => {
      const name = document.querySelector('h1')?.innerText?.trim();
      const headline = document.querySelector('.text-body-medium')?.innerText?.trim();
      const location = document.querySelector('.text-body-small')?.innerText?.trim();
      
      const sections = Array.from(document.querySelectorAll('section')).map(s => ({
        id: s.id,
        heading: s.querySelector('h2')?.innerText?.trim(),
        text: s.innerText?.replace(/\s+/g, ' ').slice(0, 1000)
      })).filter(s => s.heading);

      const openToWork = document.body.innerText.includes('Open to work') || document.body.innerText.includes('open to work');

      return {
        name,
        headline,
        location,
        openToWorkDetected: openToWork,
        sections
      };
    });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ Saved full LinkedIn details to ${OUTPUT_PATH}`);
    console.log('\n--- SNAPSHOT ---');
    console.log('Name:', data.name);
    console.log('Headline:', data.headline);
    console.log('Open to work:', data.openToWorkDetected);

  } catch (err) {
    console.error('Error inspecting LinkedIn:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
