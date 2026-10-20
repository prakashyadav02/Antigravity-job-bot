import { createBrowser } from '../src/automation/browser.js';

async function inspectPersonalCard() {
  const { browser, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: 'data/naukri_storage_state.json'
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    for (let i = 0; i < 7; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2000);

    const personalCardInfo = await page.evaluate(() => {
      // Find the card containing Personal details
      const cards = Array.from(document.querySelectorAll('.card, .widget'));
      const personalCard = cards.find(c => c.innerText?.includes('Personal details') && c.innerText?.includes('Languages'));
      if (!personalCard) return 'Personal details card not found';

      // Find all clickable elements inside personal card
      const clickables = Array.from(personalCard.querySelectorAll('span, a, button, [role="button"], .edit, .add')).map(el => ({
        tag: el.tagName,
        text: el.innerText?.trim(),
        ariaLabel: el.getAttribute('aria-label'),
        className: el.className
      })).filter(c => c.text || c.ariaLabel);

      return {
        cardHtml: personalCard.innerHTML.slice(0, 2000),
        clickables
      };
    });

    console.log('Clickables inside Personal Details card:\n', personalCardInfo.clickables);
  } finally {
    await browser.close().catch(() => {});
  }
}

inspectPersonalCard();
