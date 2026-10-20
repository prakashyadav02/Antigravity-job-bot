import { createBrowser, randomSleep } from '../src/automation/browser.js';

async function main() {
  console.log('🚀 Checking LinkedIn profile in Chrome...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome'
  });

  try {
    // Set a modern realistic user agent and headers
    await page.goto('https://www.linkedin.com/in/vivek-chaudhary-725087203/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomSleep(3000, 4000);

    const title = await page.title();
    const url = page.url();
    console.log('Current URL:', url);
    console.log('Page Title:', title);

    const isLogin = url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint');
    console.log('Is Authwall or Login:', isLogin);

    // Extract page content if public profile loaded
    const profileData = await page.evaluate(() => {
      const name = document.querySelector('h1')?.innerText?.trim();
      const headline = document.querySelector('h2, .top-card-layout__headline, .text-body-medium')?.innerText?.trim();
      const location = document.querySelector('.top-card-layout__first-subline, .text-body-small')?.innerText?.trim();
      const about = document.querySelector('section[data-section="summary"], .summary, section:has-text("About")')?.innerText?.slice(0, 500);
      const experience = Array.from(document.querySelectorAll('section:has-text("Experience") li, .experience-item, [data-section="experience"] li'))
        .map(el => el.innerText?.slice(0, 150).replace(/\s+/g, ' '));
      return {
        name,
        headline,
        location,
        about,
        experience: experience.slice(0, 5),
        bodySnippet: document.body.innerText.slice(0, 600).replace(/\s+/g, ' ')
      };
    });

    console.log('LinkedIn Profile Data:', JSON.stringify(profileData, null, 2));

  } catch (err) {
    console.error('Error checking LinkedIn:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
