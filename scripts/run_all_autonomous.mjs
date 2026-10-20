import { runNaukriDailyRanker } from '../src/automation/naukriRanker.js';
import { runDailyJobHuntAndApply } from '../src/scheduler/dailyRunner.js';
import { sendBatchRecruiterOutreach } from '../src/email/recruiterMailer.js';
import { sendBatchFollowUps } from '../src/email/followUpEngine.js';
import { createBrowser, randomSleep } from '../src/automation/browser.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INSTAHYRE_STORAGE = path.resolve(__dirname, '../data/instahyre_storage_state.json');
const APPLIED_JOBS_PATH = path.resolve(__dirname, '../data/applied_jobs.json');

async function runInstahyreStep() {
  console.log('\n============================================================');
  console.log('📌 [STEP 2/4] Running Instahyre Opportunities Sweep...');
  console.log('============================================================');
  if (!fs.existsSync(INSTAHYRE_STORAGE)) {
    console.warn('Instahyre storage state not found. Skipping Instahyre step.');
    return;
  }

  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: INSTAHYRE_STORAGE
  });

  try {
    await page.goto('https://www.instahyre.com/candidate/opportunities/?matching=true', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(2000, 3000);

    // Remove any modal or backdrop
    await page.evaluate(() => {
      document.querySelectorAll('#new-ui-announcement-modal, .application-modal-backdrop, .application-modal, .modal-backdrop').forEach(m => m.remove());
    });

    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 600);
      await randomSleep(300, 500);
    }
    await randomSleep(1500, 2500);

    const interestButtons = page.locator('button:has-text("Interested"), button:has-text("Apply"), a:has-text("Interested"), a:has-text("Apply")');
    const count = await interestButtons.count();
    console.log(`Found ${count} opportunity action buttons on Instahyre.`);

    let applied = 0;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = interestButtons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        const text = (await btn.innerText().catch(() => '')).trim();
        if (text.toLowerCase().includes('interested') || text.toLowerCase().includes('apply')) {
          await btn.scrollIntoViewIfNeeded();
          await randomSleep(800, 1200);
          await btn.click({ force: true });
          applied++;
          console.log(`✅ [Instahyre] Expressed interest #${applied}: "${text.slice(0, 40)}"`);
          await randomSleep(2000, 3000);

          const confirmBtn = page.locator('.modal button:has-text("Submit"), .modal button:has-text("Confirm"), .modal button:has-text("Yes")').first();
          if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await confirmBtn.click();
            await randomSleep(1000, 1500);
          }
        }
      }
    }
    console.log(`🎉 [Instahyre Complete] Submitted ${applied} new applications.`);
    await context.storageState({ path: INSTAHYRE_STORAGE });
  } catch (err) {
    console.warn(`[Instahyre Warning]: ${err.message}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  console.log('############################################################');
  console.log('🚀 STARTING FULL AUTONOMOUS MASTER PIPELINE');
  console.log('   Sequence: Naukri -> Instahyre -> ATS Portals -> Recruiters');
  console.log('############################################################\n');

  // STEP 1: NAUKRI RESDEX BOOST
  try {
    console.log('============================================================');
    console.log('📌 [STEP 1/4] Running Naukri Resdex Daily Ranker Boost...');
    console.log('============================================================');
    const naukriResult = await runNaukriDailyRanker({ action: 'all', headless: true });
    console.log('Naukri Ranker Status:', naukriResult.status || 'DONE');
  } catch (err) {
    console.warn('Naukri Ranker Error (Non-blocking):', err.message);
  }

  // STEP 2: INSTAHYRE OPPORTUNITIES
  await runInstahyreStep();

  // STEP 3: ATS DIRECT APPLICATIONS (Greenhouse / Lever / Ashby)
  try {
    console.log('\n============================================================');
    console.log('📌 [STEP 3/4] Running ATS Direct Job Hunt & Auto-Apply...');
    console.log('============================================================');
    await runDailyJobHuntAndApply({
      dailyMax: 5,
      maxAgeHours: 48,
      headless: true,
      sendEmail: false,
      dryRun: false
    });
  } catch (err) {
    console.warn('ATS Auto-Apply Warning (Non-blocking):', err.message);
  }

  // STEP 4: RECRUITER OUTREACH & FOLLOW-UPS
  try {
    console.log('\n============================================================');
    console.log('📌 [STEP 4/4] Dispatching Recruiter Outreach & Follow-Ups...');
    console.log('============================================================');
    await sendBatchRecruiterOutreach(3);
    await sendBatchFollowUps(3);
  } catch (err) {
    console.warn('Recruiter Outreach Warning (Non-blocking):', err.message);
  }

  console.log('\n############################################################');
  console.log('🎉 FULL AUTONOMOUS PIPELINE CYCLE COMPLETED SUCCESSFULLY!');
  console.log('############################################################');
}

main().catch(console.error);
