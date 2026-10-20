import { createBrowser, randomSleep } from '../src/automation/browser.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/instahyre_storage_state.json');
const APPLIED_JOBS_PATH = path.resolve(__dirname, '../data/applied_jobs.json');

async function main() {
  console.log('🚀 Checking and applying to matching opportunities on Instahyre...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.instahyre.com/candidate/opportunities/?matching=true', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(3000, 4000);

    console.log('Page Title:', await page.title());
    console.log('Page URL:', page.url());

    // Scroll to load job cards
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 600);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    // Extract all opportunity cards and buttons safely
    const oppDetails = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.opportunity-card, .job-card, .opp-card, [id*="opportunity"], [class*="opportunity"]'));
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="button"]'))
        .filter(b => b.offsetParent !== null)
        .map(b => ({
          tag: b.tagName,
          text: b.innerText?.trim(),
          class: b.className
        }));
      return {
        cardCount: cards.length,
        cardSnippets: cards.slice(0, 5).map(c => c.innerText?.slice(0, 120).replace(/\s+/g, ' ')),
        buttons: buttons.filter(b => b.text && b.text.length < 30)
      };
    });

    console.log('Instahyre Opportunities Summary:', JSON.stringify(oppDetails, null, 2));

    // Look for apply or interested buttons using Playwright locators
    const applyButtons = await page.locator('button:has-text("Apply"), button:has-text("Interested"), a:has-text("Apply"), a:has-text("Interested")').all();
    console.log(`Found ${applyButtons.length} actionable buttons.`);

    let appliedCount = 0;
    for (const btn of applyButtons.slice(0, 10)) {
      try {
        if (await btn.isVisible()) {
          const txt = (await btn.innerText()).trim().toLowerCase();
          if (txt.includes('apply') || txt.includes('interested')) {
            await btn.scrollIntoViewIfNeeded();
            await randomSleep(1000, 1500);
            await btn.click();
            appliedCount++;
            console.log(`✅ Applied/Expressed interest #${appliedCount}`);
            await randomSleep(2000, 3000);

            // Close or confirm modal if opened
            const confirmBtn = page.locator('.modal button:has-text("Submit"), .modal button:has-text("Apply"), .modal button:has-text("Confirm"), .modal button:has-text("Yes")').first();
            if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
              await confirmBtn.click();
              await randomSleep(1500, 2000);
            }
          }
        }
      } catch (err) {
        console.warn('Button click skipped:', err.message);
      }
    }

    console.log(`\n🎉 Instahyre Applications Complete. Total applied: ${appliedCount}`);

    // Update applied_jobs.json
    if (appliedCount > 0) {
      const appliedJobs = fs.existsSync(APPLIED_JOBS_PATH) ? JSON.parse(fs.readFileSync(APPLIED_JOBS_PATH, 'utf-8')) : [];
      appliedJobs.push({
        id: `instahyre-batch-${Date.now()}`,
        platform: 'instahyre',
        count: appliedCount,
        title: 'Java Backend SDE-II Instahyre Opportunities',
        appliedAt: new Date().toISOString(),
        status: 'SUBMITTED'
      });
      fs.writeFileSync(APPLIED_JOBS_PATH, JSON.stringify(appliedJobs, null, 2), 'utf-8');
      console.log('✅ Logged to applied_jobs.json');
    }

    await context.storageState({ path: STORAGE_STATE_PATH });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
