import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

const TARGET_HEADLINE = 'Java Backend Developer | SDE-II (3+ Yrs) | Java (8/11/17), Spring Boot, Microservices, Apache Kafka, Redis, Distributed Systems, SQL, MongoDB | Immediate Joiner / 15-30 Days Notice';

const TARGET_SUMMARY = `Results-driven Java Backend Developer (SDE-II) with 3+ years of experience in designing, building, and scaling enterprise distributed microservices using Java (8/11/17), Spring Boot, and RESTful APIs.

Core Technical Expertise:
• Languages & Frameworks: Java (8/11/17), Spring Boot, Spring MVC, Spring Data JPA, Hibernate, Spring Security.
• Distributed Systems & Caching: Apache Kafka (Event Streaming), Redis (Distributed Caching, Pub/Sub), Multithreading & Concurrency.
• Databases & Performance: MySQL, MongoDB, SQL Server, Indexing & Query Optimization.
• Architecture & Design: Microservices Architecture, Low-Level Design (LLD), System Design Patterns, Clean Code Architecture.
• Automation & DevOps: Background Scheduler Jobs (Cron), Docker, Git, CI/CD pipelines, Postman, Swagger.

Key Accomplishments:
• Architected and automated enterprise background batch schedulers, boosting data processing efficiency by 40%.
• Notice Period: 15–30 Days (Officially 60 days, pre-approved for early buyout).`;

async function main() {
  console.log('🚀 Connecting to Naukri.com with authenticated session...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(2500, 3500);

    const title = await page.title();
    console.log('Page Title:', title);
    if (page.url().includes('/nlogin') || page.url().includes('/login')) {
      console.error('❌ Session expired or not logged in.');
      return;
    }

    // -------------------------------------------------------------
    // STEP 1: Update Resume Headline
    // -------------------------------------------------------------
    console.log('\n--- [1/3] Updating Resume Headline ---');
    try {
      const editHeadlineBtn = page.locator('.resumeHeadline .edit, [class*="resumeHeadline"] [class*="edit"]').first();
      if (await editHeadlineBtn.isVisible({ timeout: 4000 })) {
        await editHeadlineBtn.click();
        await randomSleep(1500, 2500);
      }

      const headlineTextarea = page.locator('textarea#resumeHeadlineTxt, textarea[placeholder*="headline" i], .resumeHeadlineTxt').first();
      await headlineTextarea.waitFor({ state: 'visible', timeout: 5000 });
      await headlineTextarea.click();
      await headlineTextarea.fill(TARGET_HEADLINE);
      console.log('📝 Filled updated Resume Headline.');
      await randomSleep(1000, 2000);

      const saveHeadlineBtn = page.locator('form[name="resumeHeadlineForm"] button[type="submit"], .resumeHeadline button:has-text("Save"), button:has-text("Save")').first();
      await saveHeadlineBtn.click();
      console.log('💾 Clicked Save on Resume Headline!');
      await randomSleep(3000, 4500);
    } catch (e) {
      console.error('⚠️ Resume Headline update failed:', e.message);
    }

    // -------------------------------------------------------------
    // STEP 2: Update Profile Summary
    // -------------------------------------------------------------
    console.log('\n--- [2/3] Updating Profile Summary ---');
    try {
      // Scroll to Profile Summary
      const summaryCard = page.locator('.profileSummary, [class*="profileSummary"], .widget:has-text("Profile summary")').first();
      await summaryCard.scrollIntoViewIfNeeded().catch(() => {});
      await randomSleep(1500, 2500);

      const editSummaryBtn = page.locator('.profileSummary .edit, [class*="profileSummary"] [class*="edit"], .widget:has-text("Profile summary") span:has-text("edit"), .widget:has-text("Profile summary") .edit').first();
      if (await editSummaryBtn.isVisible({ timeout: 4000 })) {
        await editSummaryBtn.click();
        await randomSleep(1500, 2500);
      }

      const summaryTextarea = page.locator('textarea#profileSummaryTxt, textarea[placeholder*="summary" i], [class*="profileSummary"] textarea').first();
      if (await summaryTextarea.isVisible({ timeout: 5000 })) {
        await summaryTextarea.click();
        await summaryTextarea.fill(TARGET_SUMMARY);
        console.log('📝 Filled updated Profile Summary.');
        await randomSleep(1000, 2000);

        const saveSummaryBtn = page.locator('form[name="profileSummaryForm"] button[type="submit"], [class*="profileSummary"] button:has-text("Save"), button:has-text("Save")').first();
        await saveSummaryBtn.click();
        console.log('💾 Clicked Save on Profile Summary!');
        await randomSleep(3000, 4500);
      } else {
        console.warn('⚠️ Summary textarea not found after clicking edit.');
      }
    } catch (e) {
      console.error('⚠️ Profile Summary update failed:', e.message);
    }

    // Save updated session state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('\n✅ Updated storageState saved to disk.');

  } catch (err) {
    console.error('Error during execution:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
