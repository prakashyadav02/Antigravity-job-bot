import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/instahyre_storage_state.json');

async function main() {
  console.log('🚀 Inspecting Instahyre onboarding page...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.instahyre.com/candidate/onboard/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(3000, 4000);

    console.log('Onboard URL:', page.url());
    console.log('Onboard Title:', await page.title());

    const onboardData = await page.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, ' ').slice(0, 1000);
      const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map(el => ({
        tag: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        placeholder: el.placeholder,
        value: el.value,
        visible: el.offsetParent !== null
      }));
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim() || b.value,
        className: b.className,
        visible: b.offsetParent !== null
      }));
      return { text, inputs: inputs.filter(i => i.visible || i.type === 'file'), buttons };
    });

    console.log('Onboard Page Info:\n', JSON.stringify(onboardData, null, 2));

  } catch (err) {
    console.error('Error inspecting onboard:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
