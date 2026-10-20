import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAUKRI_STORAGE = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function testTypingEvents() {
  const { browser, page } = await createBrowser({
    headless: true,
    storageState: NAUKRI_STORAGE
  });

  const testUrl = 'https://www.naukri.com/job-listings-pyspark-developer-capgemini-technology-services-india-limited-pune-2-to-7-years-280926919797';
  console.log('Navigating to Capgemini:', testUrl);
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const applyBtn = page.locator('#apply-button').first();
  await applyBtn.click({ force: true });
  await page.waitForTimeout(3000);

  // Check what is visible
  const drawer = page.locator('.chatbot_Drawer, ._chatBotContainer').first();
  console.log('Drawer visible?', await drawer.isVisible().catch(() => false));

  const bodySnippet = (await page.locator('body').innerText()).substring(0, 300).replace(/\s+/g, ' ');
  console.log('Body:', bodySnippet);

  await browser.close();
}

testTypingEvents().catch(console.error);
