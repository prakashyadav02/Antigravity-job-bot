import { createBrowser } from '../src/automation/browser.js';

async function main() {
  const { browser, context, page } = await createBrowser({ headless: true, channel: 'chrome' });
  try {
    await page.goto('https://www.instahyre.com/login/', { waitUntil: 'domcontentloaded' });
    const forgotLink = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(el => el.innerText?.toLowerCase().includes('forgot'));
      return a ? { href: a.href, text: a.innerText } : null;
    });
    console.log('Forgot Password Link:', forgotLink);
  } finally {
    await browser.close().catch(() => {});
  }
}
main().catch(console.error);
