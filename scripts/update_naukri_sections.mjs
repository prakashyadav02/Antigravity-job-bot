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
  console.log('🚀 Connecting to Naukri.com...');
  const { browser, context, page } = await createBrowser({
    headless: true,
    channel: 'chrome',
    storageState: STORAGE_STATE_PATH
  });

  try {
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomSleep(3000, 4000);

    const title = await page.title();
    console.log('Page Title:', title);
    if (page.url().includes('/nlogin') || page.url().includes('/login')) {
      console.error('❌ Session expired or not logged in.');
      return;
    }

    // =========================================================================
    // 1. UPDATE RESUME HEADLINE
    // =========================================================================
    console.log('\n--- [Task 1] Updating Resume Headline ---');
    const headlineEdit = page.locator('span[aria-label="Edit resume headline"]').first();
    await headlineEdit.waitFor({ state: 'visible', timeout: 8000 });
    await headlineEdit.click();
    await randomSleep(2000, 3000);

    const headlineTextarea = page.locator('textarea#resumeHeadline, textarea.ge__text-area').first();
    await headlineTextarea.waitFor({ state: 'visible', timeout: 5000 });
    await headlineTextarea.fill(NEW_HEADLINE);
    console.log(`✅ Filled Headline (${NEW_HEADLINE.length} chars).`);
    await randomSleep(1500, 2500);

    // Save using evaluate to click exact visible "Save" button
    const headlineSaved = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
        .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log('💾 Headline Save button clicked:', headlineSaved);
    await randomSleep(3500, 5000);

    // =========================================================================
    // 2. SCROLL DOWN TO MOUNT LOWER SECTIONS
    // =========================================================================
    console.log('\n--- Scrolling to Profile Summary ---');
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 800);
      await randomSleep(600, 1000);
    }
    await randomSleep(2000, 3000);

    // =========================================================================
    // 3. UPDATE PROFILE SUMMARY
    // =========================================================================
    console.log('\n--- [Task 2] Updating Profile Summary ---');
    const summaryEdit = page.locator('span[aria-label="Edit profile summary"]').first();
    if (await summaryEdit.isVisible({ timeout: 6000 })) {
      await summaryEdit.click();
      await randomSleep(2000, 3000);

      const summaryTextarea = page.locator('.lightbox.model_open textarea, .drawer textarea, textarea').first();
      await summaryTextarea.waitFor({ state: 'visible', timeout: 5000 });
      await summaryTextarea.fill(NEW_SUMMARY);
      console.log(`✅ Filled Profile Summary (${NEW_SUMMARY.length} chars).`);
      await randomSleep(1500, 2500);

      const summarySaved = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.lightbox.model_open button, .drawer button, button.btn-dark-ot, button'))
          .find(b => b.innerText?.trim() === 'Save' && b.offsetParent !== null);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      console.log('💾 Profile Summary Save button clicked:', summarySaved);
      await randomSleep(3500, 5000);
    } else {
      console.warn('⚠️ Edit profile summary button not found.');
    }

    // Save final updated storage state
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('\n✅ All updates completed and storage state saved!');

  } catch (err) {
    console.error('Execution error:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
