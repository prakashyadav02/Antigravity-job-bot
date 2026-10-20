import { createBrowser, randomSleep } from '../src/automation/browser.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/instahyre_storage_state.json');
const APPLIED_JOBS_PATH = path.resolve(__dirname, '../data/applied_jobs.json');

async function main() {
  console.log('🚀 Connecting to Instahyre, clearing backdrop, and applying...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.instahyre.com/candidate/opportunities/?matching=true', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(3000, 4000);

    // Remove any blocking modals or backdrops cleanly from DOM
    await page.evaluate(() => {
      const modals = document.querySelectorAll('#new-ui-announcement-modal, .application-modal-backdrop, .application-modal, .modal-backdrop');
      modals.forEach(m => m.remove());
    });
    console.log('Cleared overlay modals.');
    await randomSleep(1500, 2000);

    // Scroll to load job cards
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 600);
      await randomSleep(300, 500);
    }
    await randomSleep(2000, 3000);

    // Find and click "Interested" / "Apply" buttons
    const interestButtons = page.locator('button:has-text("Interested"), button:has-text("Apply"), a:has-text("Interested"), a:has-text("Apply")');
    const count = await interestButtons.count();
    console.log(`Found ${count} opportunity action buttons.`);

    let appliedCount = 0;
    for (let i = 0; i < Math.min(count, 8); i++) {
      try {
        const btn = interestButtons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          const text = (await btn.innerText().catch(() => '')).trim();
          if (text.toLowerCase().includes('interested') || text.toLowerCase().includes('apply')) {
            await btn.scrollIntoViewIfNeeded();
            await randomSleep(800, 1200);
            await btn.click({ force: true });
            appliedCount++;
            console.log(`✅ Applied/Expressed interest (#${appliedCount}): "${text}"`);
            await randomSleep(2000, 3000);

            // Close confirmation modal if any
            const confirmBtn = page.locator('.modal button:has-text("Submit"), .modal button:has-text("Confirm"), .modal button:has-text("Yes")').first();
            if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
              await confirmBtn.click();
              await randomSleep(1500, 2000);
            }
          }
        }
      } catch (err) {
        console.warn('Skipped button:', err.message);
      }
    }

    console.log(`\n🎉 Total Instahyre Applications: ${appliedCount}`);

    if (appliedCount > 0) {
      const appliedJobs = fs.existsSync(APPLIED_JOBS_PATH) ? JSON.parse(fs.readFileSync(APPLIED_JOBS_PATH, 'utf-8')) : [];
      appliedJobs.push({
        id: `instahyre-batch-${Date.now()}`,
        platform: 'instahyre',
        count: appliedCount,
        title: 'Java Backend SDE-II (Instahyre Inbound Applications)',
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
