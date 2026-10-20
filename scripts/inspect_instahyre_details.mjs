import { createBrowser, randomSleep } from '../src/automation/browser.js';

async function main() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome'
  });

  try {
    await page.goto('https://www.instahyre.com/candidate/login/', { waitUntil: 'networkidle', timeout: 30000 });
    await randomSleep(2000, 3000);

    const info = await page.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, ' ').slice(0, 1000);
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        href: a.href,
        text: a.innerText?.trim()
      })).filter(a => a.text);
      const allInputs = Array.from(document.querySelectorAll('input, button')).map(el => ({
        tag: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        text: el.innerText?.trim(),
        placeholder: el.placeholder
      }));
      return { text, links: links.slice(0, 15), allInputs };
    });

    console.log('Instahyre page info:', JSON.stringify(info, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
