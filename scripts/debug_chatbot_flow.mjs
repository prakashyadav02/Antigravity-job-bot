import { createBrowser } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAUKRI_STORAGE = path.resolve(__dirname, '../data/naukri_storage_state.json');

async function debugChatbotFlow() {
  const { browser, page } = await createBrowser({
    headless: true,
    storageState: NAUKRI_STORAGE
  });

  const testUrl = 'https://www.naukri.com/job-listings-pyspark-databricks-developer-pan-india-infosys-hyderabad-pune-bengaluru-2-to-5-years-290726018507';
  await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForTimeout(3000);

  const applyBtn = page.locator('#apply-button').first();
  await applyBtn.click({ force: true });
  await page.waitForTimeout(3000);

  for (let turn = 1; turn <= 5; turn++) {
    console.log(`\n--- TURN ${turn} ---`);
    const msgs = await page.locator('.botMsg, .chatbot_ListItem').allInnerTexts().catch(() => []);
    console.log('Bot messages:', msgs);

    const chips = await page.locator('.chatbot_Chip, .chipItem, .chips').allInnerTexts().catch(() => []);
    console.log('Chips visible:', chips);

    const hasInput = await page.locator('.textArea[contenteditable="true"]').isVisible().catch(() => false);
    console.log('Contenteditable input visible:', hasInput);

    if (chips.length > 0) {
      console.log(`Clicking chip: "${chips[0]}"`);
      await page.locator('.chatbot_Chip, .chipItem').first().click();
      await page.waitForTimeout(3000);
    } else if (hasInput) {
      const lastMsg = msgs[msgs.length - 1] || '';
      let ans = 'NA';
      if (/experience|years/i.test(lastMsg)) ans = '2.8';
      else if (/notice/i.test(lastMsg)) ans = '15';
      else if (/ctc|salary/i.test(lastMsg)) ans = '12';
      else if (/spark|python|databricks|sql/i.test(lastMsg)) ans = 'Yes';
      console.log(`Typing answer "${ans}" for message: "${lastMsg}"`);
      const editable = page.locator('.textArea[contenteditable="true"]').first();
      await editable.click();
      await page.keyboard.type(ans, { delay: 25 });
      await page.waitForTimeout(500);
      const saveBtn = page.locator('.sendMsg, button:has-text("Save")').first();
      await saveBtn.click({ force: true });
      await page.waitForTimeout(3000);
    } else {
      console.log('No chips or input found. Breaking.');
      break;
    }
  }

  const finalBody = await page.locator('body').innerText();
  console.log('Final Body Snippet:', finalBody.substring(0, 300).replace(/\s+/g, ' '));

  await browser.close();
}

debugChatbotFlow().catch(console.error);
