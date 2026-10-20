import { createBrowser, randomSleep } from '../src/automation/browser.js';

async function main() {
  console.log('🚀 Checking Instahyre login & signup pages...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome'
  });

  try {
    await page.goto('https://www.instahyre.com/candidate/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomSleep(2000, 3000);

    console.log('Login Page Title:', await page.title());
    console.log('Login URL:', page.url());

    // Inspect login form
    const loginForm = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        placeholder: i.placeholder
      }));
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim() || b.value,
        className: b.className
      }));
      return { inputs, buttons };
    });

    console.log('Login Form Details:', JSON.stringify(loginForm, null, 2));

    // Also check signup page
    await page.goto('https://www.instahyre.com/candidate/signup/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomSleep(2000, 3000);

    console.log('\nSignup Page Title:', await page.title());
    console.log('Signup URL:', page.url());

    const signupForm = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
        id: i.id,
        name: i.name,
        type: i.type,
        placeholder: i.placeholder
      }));
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).map(b => ({
        tag: b.tagName,
        text: b.innerText?.trim() || b.value,
        className: b.className
      }));
      return { inputs, buttons };
    });

    console.log('Signup Form Details:', JSON.stringify(signupForm, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
