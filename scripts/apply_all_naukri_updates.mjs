import { createBrowser, randomSleep } from '../src/automation/browser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_STATE_PATH = path.resolve(__dirname, '../data/naukri_storage_state.json');

const NEW_HEADLINE = 'Java Backend Developer | SDE-II (3+ Yrs) | Java (8/11/17), Spring Boot, Microservices, Apache Kafka, Redis, Distributed Systems, SQL, MongoDB | Immediate Joiner / 15-30 Days Notice';

const NEW_SUMMARY = `Results-driven Java Backend Developer (SDE-II) with 3+ years of experience in designing, building, and scaling enterprise distributed microservices using Java (8/11/17), Spring Boot, and RESTful APIs.

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
  console.log('🚀 [Naukri Optimizer] Starting safe profile enhancement session...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4500);

    const title = await page.title();
    console.log('Page Title:', title);
    if (page.url().includes('/nlogin') || page.url().includes('/login')) {
      console.error('❌ Session expired or not logged in.');
      return;
    }

    // =========================================================================
    // 1. UPDATE RESUME HEADLINE
    // =========================================================================
    console.log('\n--- [Task 1/3] Updating Resume Headline ---');
    try {
      const headlineEdit = page.locator('span[aria-label="Edit resume headline"]').first();
      await headlineEdit.waitFor({ state: 'visible', timeout: 8000 });
      await headlineEdit.click();
      await randomSleep(2000, 3000);

      const headlineTextarea = page.locator('#resumeHeadline, textarea.ge__text-area, textarea').first();
      await headlineTextarea.waitFor({ state: 'visible', timeout: 5000 });
      await headlineTextarea.click();
      await headlineTextarea.fill(NEW_HEADLINE);
      console.log(`✅ Filled Headline (${NEW_HEADLINE.length} chars).`);
      await randomSleep(1500, 2500);

      const headlineSaveBtn = page.locator('.resumeHeadlineEdit button:has-text("Save"), .lightbox button.btn-dark-ot:has-text("Save"), button.btn-dark-ot:has-text("Save")').first();
      await headlineSaveBtn.click();
      console.log('💾 Clicked Save on Resume Headline.');
      await randomSleep(3000, 4500);
    } catch (e) {
      console.error('⚠️ Task 1 Error:', e.message);
    }

    // =========================================================================
    // 2. SCROLL DOWN TO MOUNT LOWER PROFILE SECTIONS
    // =========================================================================
    console.log('\n--- Scrolling to mount Profile Summary & Personal Details ---');
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 1000);
      await randomSleep(800, 1200);
    }
    await randomSleep(2000, 3000);

    // =========================================================================
    // 3. UPDATE PROFILE SUMMARY
    // =========================================================================
    console.log('\n--- [Task 2/3] Updating Profile Summary ---');
    try {
      const summaryEdit = page.locator('span[aria-label="Edit profile summary"]').first();
      if (await summaryEdit.isVisible({ timeout: 6000 })) {
        await summaryEdit.click();
        await randomSleep(2000, 3000);

        const summaryTextarea = page.locator('.lightbox textarea, .drawer textarea, textarea').first();
        if (await summaryTextarea.isVisible({ timeout: 5000 })) {
          await summaryTextarea.click();
          await summaryTextarea.fill(NEW_SUMMARY);
          console.log(`✅ Filled Profile Summary (${NEW_SUMMARY.length} chars).`);
          await randomSleep(1500, 2500);

          const summarySaveBtn = page.locator('.lightbox button.btn-dark-ot:has-text("Save"), .drawer button.btn-dark-ot:has-text("Save"), button.btn-dark-ot:has-text("Save")').first();
          await summarySaveBtn.click();
          console.log('💾 Clicked Save on Profile Summary.');
          await randomSleep(3000, 4500);
        } else {
          console.warn('⚠️ Profile Summary textarea was not visible in modal.');
        }
      } else {
        console.warn('⚠️ Profile Summary edit button not visible after scroll.');
      }
    } catch (e) {
      console.error('⚠️ Task 2 Error:', e.message);
    }

    // =========================================================================
    // 4. INSPECT PERSONAL DETAILS / LANGUAGES
    // =========================================================================
    console.log('\n--- [Task 3/3] Inspecting Languages / Personal Details ---');
    try {
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 1000);
        await randomSleep(600, 1000);
      }

      const personalEdit = page.locator('span[aria-label="Edit personal details"]').first();
      if (await personalEdit.isVisible({ timeout: 6000 })) {
        console.log('Found Edit personal details button.');
        await personalEdit.click();
        await randomSleep(2000, 3000);

        // Check modal contents
        const modalInfo = await page.evaluate(() => {
          const modal = document.querySelector('.lightbox, .drawer, [class*="profileEditDrawer"]');
          return {
            title: modal?.querySelector('h1, h2, h3, .title, .heading')?.innerText?.trim(),
            textSnippet: modal?.innerText?.slice(0, 500)
          };
        });
        console.log('Personal Details Modal Info:', modalInfo);

        // Let's close modal safely without changing if unsure
        const closeBtn = page.locator('.lightbox .crossLayer, .lightbox [class*="close"], .lightbox button:has-text("Cancel")').first();
        if (await closeBtn.isVisible({ timeout: 3000 })) {
          await closeBtn.click();
        }
      }
    } catch (e) {
      console.error('⚠️ Task 3 Error:', e.message);
    }

    // Save final updated session
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('\n🎉 Finished profile enhancement session! Storage state updated.');

  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
