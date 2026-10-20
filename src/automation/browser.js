import { chromium } from 'playwright';
import fs from 'fs';

export async function createBrowser(options = {}) {
  const { headless = false, slowMo = 50 } = options;

  const browser = await chromium.launch({
    headless,
    slowMo,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-size=1280,800'
    ]
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata'
  };

  if (options.storageState && fs.existsSync(options.storageState)) {
    contextOptions.storageState = options.storageState;
  }

  const context = await browser.newContext(contextOptions);

  // Anti-detection script to hide webdriver property and emulate real Chrome browser
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
    if (!window.chrome) {
      window.chrome = { runtime: {} };
    }
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
  });

  const page = await context.newPage();
  return { browser, context, page };
}

export async function humanType(page, selector, text, delayRange = [30, 80]) {
  const element = page.locator(selector).first();
  try {
    await element.click({ timeout: 2500 });
  } catch {
    // If blocked by cookie consent or overlay modal, dismiss modal and force click
    await page.evaluate(() => {
      document.querySelectorAll('.consent-modal, [class*="consent"], [aria-label*="Cookie"], .modal-backdrop, #onetrust-banner-sdk').forEach(el => el.remove());
    }).catch(() => {});
    await element.click({ force: true }).catch(() => {});
  }
  await element.fill('').catch(() => {}); // Clear first

  for (const char of text) {
    await element.pressSequentially(char, {
      delay: Math.floor(Math.random() * (delayRange[1] - delayRange[0])) + delayRange[0]
    });
  }
}

export async function randomSleep(minMs = 1000, maxMs = 2500) {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
}
