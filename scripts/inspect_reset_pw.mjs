import { createBrowser } from '../src/automation/browser.js';

async function main() {
  const { browser, context, page } = await createBrowser({ headless: true, channel: 'chrome' });
  try {
    await page.goto('https://www.instahyre.com/reset_password/', { waitUntil: 'domcontentloaded' });
    const details = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({ id: i.id, name: i.name, placeholder: i.placeholder }));
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({ tag: b.tagName, text: b.innerText?.trim() || b.value }));
      return { inputs, btns };
    });
    console.log('Reset Password Form:', details);
  } finally {
    await browser.close().catch(() => {});
  }
}
main().catch(console.error);
