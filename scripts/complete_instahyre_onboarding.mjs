import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/instahyre_storage_state.json');
const RESUME_PATH = path.resolve(__dirname, '../data/Vivek-Chowdhary-Resume.pdf');

const SKILLS_TO_ADD = [
  'Spring Boot',
  'Microservices',
  'Apache Kafka',
  'Redis',
  'MySQL',
  'MongoDB',
  'REST APIs',
  'Multithreading',
  'Docker'
];

async function main() {
  console.log('🚀 Completing Instahyre Onboarding (Skills, Preferences, Resume, Privacy)...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.instahyre.com/candidate/onboard/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomSleep(3000, 4000);

    // =========================================================================
    // STEP 1: ADD SKILLS & PROFESSIONAL STATUS
    // =========================================================================
    console.log('\n--- [Step 1] Skills & Status ---');
    
    // Select "I am a working professional"
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label, div, span'));
      const target = labels.find(l => l.innerText?.trim() === 'I am a working professional');
      if (target) target.click();
    });
    await randomSleep(800, 1200);

    // Select "Full-time only"
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('label, div, span'));
      const target = labels.find(l => l.innerText?.trim() === 'Full-time only');
      if (target) target.click();
    });
    await randomSleep(800, 1200);

    // Add skills in the selectized input: #name-selectized
    const skillInput = page.locator('input#name-selectized, input[placeholder*="skills" i]').first();
    if (await skillInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      for (const skill of SKILLS_TO_ADD) {
        await skillInput.click();
        await page.keyboard.type(skill, { delay: 60 });
        await randomSleep(800, 1200);
        // Press Enter to add chip
        await page.keyboard.press('Enter');
        await randomSleep(400, 700);
      }
      console.log('Added skills chips:', SKILLS_TO_ADD.join(', '));
    }

    // Click Next
    console.log('Clicking Next on Step 1...');
    await page.click('button.onboard-next-button, button:has-text("Next")');
    await randomSleep(4000, 5000);

    // =========================================================================
    // STEP 2: JOB PREFERENCES (Locations, CTC, Notice Period)
    // =========================================================================
    console.log('\n--- [Step 2] Job Preferences ---');
    console.log('Step 2 Page Text:', (await page.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\s+/g, ' '));

    // Handle inputs on Step 2
    // Look for Experience: 3 Years
    // Look for Notice Period: 15-30 Days
    // Look for Current CTC: 12.5 LPA
    // Look for Expected CTC: 18-22 LPA
    // Look for Locations: Noida, Gurgaon, Bangalore, Hyderabad, Pune, Remote
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select'));
      for (const inp of inputs) {
        const ph = (inp.placeholder || '').toLowerCase();
        const name = (inp.name || '').toLowerCase();
        const id = (inp.id || '').toLowerCase();

        // Current CTC
        if (ph.includes('current ctc') || name.includes('current_ctc') || id.includes('current-ctc')) {
          inp.value = '1250000';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Expected CTC
        if (ph.includes('expected ctc') || name.includes('expected_ctc') || id.includes('expected-ctc')) {
          inp.value = '2000000';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    // Handle notice period dropdown or radios
    await page.evaluate(() => {
      const allOptions = Array.from(document.querySelectorAll('option, label, div.selectize-dropdown-content div'));
      const noticeOpt = allOptions.find(o => {
        const t = o.innerText?.toLowerCase() || '';
        return t.includes('15 days') || t.includes('30 days') || t.includes('1 month') || t.includes('immediate');
      });
      if (noticeOpt) noticeOpt.click();
    });

    await randomSleep(2000, 3000);

    // Click Next on Step 2
    const nextBtn2 = page.locator('button.onboard-next-button, button:has-text("Next")').first();
    if (await nextBtn2.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('Clicking Next on Step 2...');
      await nextBtn2.click();
      await randomSleep(4000, 5000);
    }

    // =========================================================================
    // STEP 3: UPLOAD RESUME
    // =========================================================================
    console.log('\n--- [Step 3] Resume Upload ---');
    console.log('Step 3 Page Text:', (await page.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\s+/g, ' '));

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      console.log(`Uploading resume from ${RESUME_PATH}...`);
      await fileInput.setInputFiles(RESUME_PATH);
      await randomSleep(3000, 5000);
      console.log('✅ Resume uploaded.');
    }

    // Click Next on Step 3
    const nextBtn3 = page.locator('button.onboard-next-button, button:has-text("Next")').first();
    if (await nextBtn3.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log('Clicking Next on Step 3...');
      await nextBtn3.click();
      await randomSleep(4000, 5000);
    }

    // =========================================================================
    // STEP 4: PRIVACY SETTINGS & FINISH
    // =========================================================================
    console.log('\n--- [Step 4] Privacy Settings & Submit ---');
    console.log('Step 4 Page Text:', (await page.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\s+/g, ' '));

    // Hide profile from current company: Insightgeeks
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const blockCompanyInput = inputs.find(i => (i.placeholder || '').toLowerCase().includes('company') || (i.name || '').includes('block'));
      if (blockCompanyInput) {
        blockCompanyInput.value = 'InsightGeeks Solutions';
        blockCompanyInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await randomSleep(1500, 2000);

    // Click Finish / Submit / Save
    const finishBtn = page.locator('button:has-text("Finish"), button:has-text("Submit"), button:has-text("Save"), button.onboard-next-button').first();
    if (await finishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Clicking Finish button...');
      await finishBtn.click();
      await randomSleep(5000, 7000);
    }

    // Check final landing URL
    console.log('\nLanding URL after onboarding:', page.url());
    console.log('Landing Title:', await page.title());

    // Save final updated storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('✅ Instahyre onboarding completed and storage state saved!');

  } catch (err) {
    console.error('Error during onboarding:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
