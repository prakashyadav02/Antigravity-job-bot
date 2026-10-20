import { createBrowser, randomSleep } from '../src/automation/browser.js';

async function main() {
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome'
  });

  try {
    await page.goto('https://www.instahyre.com/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomSleep(2000, 3000);

    const loginDetails = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        placeholder: i.placeholder,
        visible: i.offsetParent !== null
      }));
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim() || b.value,
        className: b.className,
        visible: b.offsetParent !== null
      }));
      return {
        title: document.title,
        url: window.location.href,
        inputs: inputs.filter(i => i.visible),
        buttons: buttons.filter(b => b.visible)
      };
    });

    console.log('Instahyre Login Form:', JSON.stringify(loginDetails, null, 2));

    await page.goto('https://www.instahyre.com/candidates/register/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomSleep(2000, 3000);

    const regDetails = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        placeholder: i.placeholder,
        visible: i.offsetParent !== null
      }));
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim() || b.value,
        className: b.className,
        visible: b.offsetParent !== null
      }));
      return {
        title: document.title,
        url: window.location.href,
        inputs: inputs.filter(i => i.visible),
        buttons: buttons.filter(b => b.visible)
      };
    });

    console.log('Instahyre Registration Form:', JSON.stringify(regDetails, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
