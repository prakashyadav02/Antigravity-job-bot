import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAUKRI_STORAGE = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function testOneApply() {
  const { browser, page } = await createBrowser({
    headless: true,
    storageState: NAUKRI_STORAGE
  });

  const testUrl = 'https://www.naukri.com/job-listings-pyspark-databricks-developer-pan-india-infosys-hyderabad-pune-bengaluru-2-to-5-years-290726018507';
  console.log('Navigating to test job:', testUrl);
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const applyBtn = page.locator('#apply-button, .apply-button, button:has-text("Apply")').first();
  const isVisible = await applyBtn.isVisible().catch(() => false);
  const text = (await applyBtn.innerText().catch(() => '')).trim();
  console.log(`Apply button visible: ${isVisible}, text: "${text}"`);

  if (isVisible && !text.toLowerCase().includes('company site') && !text.toLowerCase().includes('applied')) {
    console.log('Clicking Apply button...');
    await applyBtn.click({ force: true });
    await page.waitForTimeout(3000);

    // Check chatbot questionnaire
    const editable = page.locator('.textArea[contenteditable="true"], [data-placeholder*="message"]').first();
    const skipChip = page.locator('.chipItem, .chatbot_Chip, text="Skip this question"').first();

    if (await skipChip.isVisible().catch(() => false)) {
      console.log('Clicking Skip chip...');
      await skipChip.click();
      await page.waitForTimeout(2500);
    } else if (await editable.isVisible().catch(() => false)) {
      console.log('Typing answer in editable input...');
      await editable.click();
      await page.keyboard.type('NA', { delay: 25 });
      await page.waitForTimeout(500);
      const saveBtn = page.locator('.sendMsg, button:has-text("Save")').first();
      await saveBtn.click({ force: true });
      await page.waitForTimeout(3000);
    }

    const pageBody = await page.locator('body').innerText();
    const isSuccess = /applied to|applied successfully|application submitted|already applied/i.test(pageBody);
    console.log('Application status: SUCCESS =', isSuccess);
    const snippet = pageBody.substring(0, 300).replace(/\s+/g, ' ');
    console.log('Body snippet:', snippet);
  }

  await browser.close();
}

testOneApply().catch(console.error);
