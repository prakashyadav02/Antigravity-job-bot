import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBrowser, randomSleep } from './browser.js';
import { loadProfile, isCompanyExcluded } from '../config.js';
import { isAlreadyApplied, isRoleAlreadyApplied, recordApplication, getTodayAppliedCount } from '../tracker.js';
import { isExperienceMatching } from '../scrapers/jobFinder.js';
import { recordDiscoveredLead } from '../scrapers/recruiterFinder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAUKRI_STORAGE = path.resolve(__dirname, '../../data/naukri_storage_state.json');

const TARGET_ROLE_QUERIES = [
  'data-engineer-jobs',
  'pyspark-developer-jobs',
  'spark-data-engineer-jobs',
  'databricks-jobs',
  'etl-developer-jobs',
  'big-data-engineer-jobs',
  'python-data-engineer-jobs',
  'sql-data-engineer-jobs',
  'aws-data-engineer-jobs',
  'azure-data-engineer-jobs'
];

/**
 * Validates that job title matches Data Engineering / Analytics / Tech roles
 * and filters out irrelevant promoted positions (e.g. Sales, Recruiter, Graphic Designer)
 */
export function isDataEngineeringRole(title) {
  const t = (title || '').toLowerCase();
  const negativePattern = /\b(business development|bde|sales|telecaller|tele-sales|customer care|customer support|recruiter|recruitment|talent acquisition|graphic design|designer|ui\/ux|video editor|accountant|accounts|audit|lawyer|legal|nurse|pharmacist|chef|receptionist|front office|content writer|marketing executive|seo)\b/i;
  if (negativePattern.test(t)) return false;

  const positivePattern = /\b(data|pyspark|spark|etl|databricks|pipeline|big data|analytics|warehouse|bi|sql|python|cloud|database|azure|aws|ai|ml|machine learning|software|developer|engineer)\b/i;
  return positivePattern.test(t);
}

/**
 * Searches and automatically applies to Data Engineer jobs on Naukri (0-5 YOE)
 * Supports daily max apply limit, career site redirects, screening answers,
 * and extracts recruiter emails from job descriptions.
 */
export async function applyToNaukriJobs(options = {}) {
  const {
    maxApplications = 20,
    dailyMax = false,
    allowCareerSites = true,
    headless = true,
    minExp = 0,
    maxExp = 5
  } = options;

  const targetApplications = dailyMax ? 50 : maxApplications;
  const todayApplied = getTodayAppliedCount('NAUKRI');

  console.log(`\n============================================================`);
  console.log(`🚀 [NAUKRI AUTO-APPLY] Fresh 0-5 YOE Data Engineer Roles`);
  console.log(`Target: Up to ${targetApplications} applications (Today's count: ${todayApplied}) | Headless: ${headless}`);
  if (dailyMax) console.log(`Mode: Daily Max Quota (~50/day) | Career Sites: ${allowCareerSites ? 'Enabled' : 'Disabled'}`);
  console.log(`============================================================`);

  if (dailyMax && todayApplied >= 50) {
    console.log(`🎉 Naukri daily application quota (~50 jobs) already reached today (${todayApplied} submitted). Skipping further applications today.`);
    return { appliedCount: 0, applications: [], dailyQuotaReached: true };
  }

  if (!fs.existsSync(NAUKRI_STORAGE)) {
    console.warn('⚠️ Naukri session file not found. Please log in first via login_naukri.bat.');
    return { appliedCount: 0, applications: [] };
  }

  const profile = loadProfile();
  const noticeDays = String(profile.workPreferences?.effectiveNoticePeriodDays || profile.workPreferences?.officialNoticePeriodDays || 15);
  const totalExp = String(profile.experience?.totalYears || profile.customAnswers?.yearsOfExperience || '2.8').replace(/[^0-9.]/g, '') || '2.8';
  const currentCtc = String(profile.workPreferences?.currentSalary || '10 LPA').replace(/[^0-9.]/g, '') || '10';
  const expectedCtc = String(profile.workPreferences?.expectedSalary || '15 LPA').replace(/[^0-9.]/g, '') || '15';
  const primarySkills = profile.customAnswers?.primarySkills || 'Python, PySpark, Apache Spark, SQL, Databricks, Apache Airflow, Kafka, AWS S3';
  const currentCompany = profile.experience?.currentCompany || 'SOLIZE India Technologies Private Limited';

  const { browser, page } = await createBrowser({
    headless,
    channel: 'chrome',
    storageState: NAUKRI_STORAGE
  });

  const applications = [];

  try {
    const seenUrls = new Set();
    const seenKeys = new Set();
    const candidates = [];

    // Search across targeted Data Engineer role queries sorted by fresh (sortBy=f)
    for (const q of TARGET_ROLE_QUERIES) {
      if (candidates.length >= maxApplications * 2) break;

      for (let pageNum = 1; pageNum <= 5 && candidates.length < maxApplications * 2; pageNum++) {
        const searchUrl = pageNum === 1
          ? `https://www.naukri.com/${q}?experience=0&experience=1&experience=2&experience=3&experience=4&experience=5&sortBy=f`
          : `https://www.naukri.com/${q}-${pageNum}?experience=0&experience=1&experience=2&experience=3&experience=4&experience=5&sortBy=f`;

        console.log(`[Naukri] Query: "${q}" | Page ${pageNum}: ${searchUrl}`);
        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await randomSleep(2000, 3000);

          // Scroll to load job cards
          for (let s = 0; s < 3; s++) {
            await page.evaluate(() => window.scrollBy(0, 1000));
            await randomSleep(300, 500);
          }

          let jobTuples = await page.locator('.srp-jobtuple-wrapper').all();
          if (jobTuples.length === 0) {
            jobTuples = await page.locator('.cust-job-tuple').all();
          }

          console.log(`[Naukri] Query "${q}" Page ${pageNum}: Found ${jobTuples.length} job cards.`);

          for (const tuple of jobTuples) {
            const cardText = (await tuple.innerText().catch(() => '')).toLowerCase();

            // PRE-FILTER 1: Handle external company site postings
            const isCompanySite = cardText.includes('company site') || cardText.includes('apply on company');
            if (isCompanySite && !allowCareerSites) {
              continue;
            }

            // PRE-FILTER 2: Skip already applied cards directly
            if (cardText.includes('applied') && !cardText.includes('easy apply')) {
              continue;
            }

            const title = (await tuple.locator('.title, a.title').first().innerText().catch(() => '')).trim();
            const company = (await tuple.locator('.comp-name, a.comp-name').first().innerText().catch(() => '')).trim();
            const exp = (await tuple.locator('.exp, .exp-wrap').first().innerText().catch(() => '')).trim();
            const loc = (await tuple.locator('.loc, .loc-wrap').first().innerText().catch(() => '')).trim();
            const rawLink = await tuple.locator('.title, a.title').first().getAttribute('href').catch(() => '');

            if (!title || !company || !rawLink) continue;

            const cleanUrl = rawLink.split('?')[0];
            const key = `${company.toLowerCase()}|${title.toLowerCase()}`;

            if (seenUrls.has(cleanUrl) || seenKeys.has(key)) continue;
            seenUrls.add(cleanUrl);
            seenKeys.add(key);

            // Safety check against excluded employers & experience range
            if (isCompanyExcluded(company, cleanUrl)) continue;
            if (isAlreadyApplied(cleanUrl) || isRoleAlreadyApplied(company, title)) continue;
            if (!isDataEngineeringRole(title)) continue;
            if (!isExperienceMatching(`${title} ${exp}`, minExp, maxExp)) continue;

            candidates.push({ title, company, exp, loc, url: cleanUrl, isCompanySite });
            if (candidates.length >= targetApplications * 3) break;
          }
        } catch (pageErr) {
          console.warn(`[Naukri] Warning loading ${q} page ${pageNum}: ${pageErr.message}`);
        }
      }
    }

    console.log(`\n🎯 Discovered ${candidates.length} unique Data Engineer postings!`);

    for (let i = 0; i < candidates.length && applications.length < targetApplications; i++) {
      const job = candidates[i];
      console.log(`\n------------------------------------------------------------`);
      console.log(`[Naukri Apply ${applications.length + 1}/${targetApplications}] "${job.title}" @ ${job.company}${job.isCompanySite ? ' [Career Site]' : ''}`);
      console.log(`Experience: ${job.exp} | Location: ${job.loc}`);
      console.log(`URL: ${job.url}`);

      try {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomSleep(2000, 3000);

        // Check if already applied on page
        const initialBody = await page.locator('body').innerText().catch(() => '');

        // Extract any recruiter contact email from the Naukri job description
        const emailMatches = initialBody.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g) || [];
        const cleanEmails = emailMatches.filter(e => {
          const l = e.toLowerCase();
          return !l.includes('.png') && !l.includes('.jpg') && !l.includes('sentry') && !l.includes('example.com') && !l.includes('w3.org');
        });
        if (cleanEmails.length > 0) {
          await recordDiscoveredLead({
            company: job.company,
            title: job.title,
            jobUrl: job.url,
            targetEmail: cleanEmails[0].toLowerCase(),
            sourcePortal: 'Naukri Job Posting',
            emailType: 'Direct Recruiter in Post'
          }).catch(() => {});
        }

        // Check if daily limit reached
        if (/daily.*(limit|quota)|reached.*daily.*limit|applied.*maximum.*today/i.test(initialBody)) {
          console.log('🛑 [Naukri Quota] Daily application limit reached on Naukri for today! Stopping gracefully.');
          break;
        }

        if (/already applied|applied on/i.test(initialBody)) {
          console.log(`ℹ️ Already applied previously. Recording & moving next.`);
          recordApplication({
            company: job.company,
            title: job.title,
            url: job.url,
            platform: 'NAUKRI',
            status: 'ALREADY_APPLIED',
            notes: 'Detected existing apply state on page'
          });
          continue;
        }

        const applyBtn = page.locator('#apply-button, .apply-button, button:has-text("Apply")').first();
        if (!(await applyBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
          console.log(`⏭️ Apply button not visible. Skipping.`);
          continue;
        }

        const btnText = (await applyBtn.innerText().catch(() => '')).trim();
        if (btnText.toLowerCase().includes('company site')) {
          if (allowCareerSites) {
            console.log(`🌐 [Career Site Apply] Opening company portal for ${job.company} (${job.title})...`);
            try {
              const [popup] = await Promise.all([
                page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null),
                applyBtn.click({ force: true })
              ]);
              const targetPage = popup || page;
              await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
              const externalUrl = targetPage.url();
              console.log(`🌐 Opened company site: ${externalUrl}`);

              const { applyToJobUrl } = await import('./jobUrlApplier.js');
              const res = await applyToJobUrl(externalUrl, {
                companyName: job.company,
                jobTitle: job.title,
                headless
              });
              if (popup) await popup.close().catch(() => {});

              if (res.success) {
                applications.push({
                  company: job.company,
                  title: job.title,
                  url: job.url,
                  status: 'SUBMITTED',
                  platform: 'CAREER_SITE'
                });
                console.log(`✅ [Career Site Applied] Successfully submitted to ${job.company}!`);
              }
            } catch (careerErr) {
              console.warn(`⚠️ Career site apply error for ${job.company}: ${careerErr.message}`);
            }
            continue;
          } else {
            console.log(`ℹ️ External company site application. Skipping for direct 1-click.`);
            continue;
          }
        }

        if (/applied/i.test(btnText)) {
          console.log(`ℹ️ Button indicates "Applied". Recording & moving next.`);
          recordApplication({
            company: job.company,
            title: job.title,
            url: job.url,
            platform: 'NAUKRI',
            status: 'ALREADY_APPLIED',
            notes: 'Button shows applied'
          });
          continue;
        }

        // Click Apply
        console.log(`🖱️ Clicking Apply button...`);
        await applyBtn.click({ force: true });
        await randomSleep(2500, 3500);

        // Handle interactive chatbot / screening questionnaire (multi-turn)
        for (let turn = 0; turn < 5; turn++) {
          const editable = page.locator('.textArea[contenteditable="true"], [data-placeholder*="message"]').first();
          const skipChip = page.locator('.chipItem, .chatbot_Chip, text="Skip this question"').first();
          const standardInput = page.locator('.chatbot_Drawer input[type="text"], ._chatBotContainer input[type="text"], textarea').first();

          const hasEditable = await editable.isVisible().catch(() => false);
          const hasSkipChip = await skipChip.isVisible().catch(() => false);
          const hasStandard = await standardInput.isVisible().catch(() => false);

          if (!hasEditable && !hasSkipChip && !hasStandard) {
            break; // No questionnaire prompts active
          }

          console.log(`💬 [Chatbot Q&A Turn ${turn + 1}] Processing screening prompt...`);

          // Read the question text
          const lastMsg = (await page.locator('.botMsg, .chatbot_ListItem, .bot-message').last().innerText().catch(() => '')).toLowerCase();

          // Check if there are chips matching the expected answer
          let clickedChip = false;
          if (lastMsg.includes('notice')) {
            const chipMatch = page.locator(`.chipItem:has-text("${noticeDays}"), .chatbot_Chip:has-text("${noticeDays}"), .chipItem:has-text("15"), .chipItem:has-text("30")`).first();
            if (await chipMatch.isVisible().catch(() => false)) {
              console.log(`   👉 Clicking matching notice period chip...`);
              await chipMatch.click().catch(() => {});
              clickedChip = true;
              await randomSleep(1500, 2500);
            }
          } else if (lastMsg.includes('experience') || lastMsg.includes('yoe')) {
            const expChip = page.locator(`.chipItem:has-text("2"), .chipItem:has-text("3"), .chatbot_Chip:has-text("2")`).first();
            if (await expChip.isVisible().catch(() => false)) {
              console.log(`   👉 Clicking experience chip...`);
              await expChip.click().catch(() => {});
              clickedChip = true;
              await randomSleep(1500, 2500);
            }
          }

          if (clickedChip) continue;

          if (hasSkipChip) {
            console.log(`   👉 Clicking "Skip this question" chip...`);
            await skipChip.click().catch(() => {});
            await randomSleep(1500, 2500);
          } else if (hasEditable) {
            let answer = 'NA';
            if (/notice/i.test(lastMsg)) {
              answer = noticeDays;
            } else if (/experience|years|yoe/i.test(lastMsg)) {
              answer = totalExp;
            } else if (/current.*(ctc|salary|package)/i.test(lastMsg)) {
              answer = currentCtc;
            } else if (/expected.*(ctc|salary|package)|ctc|salary/i.test(lastMsg)) {
              answer = expectedCtc;
            } else if (/company|current.*employer/i.test(lastMsg)) {
              answer = currentCompany;
            } else if (/spark|python|sql|databricks|airflow|tech|skill/i.test(lastMsg)) {
              answer = `Yes, hands-on production experience in ${primarySkills}.`;
            } else if (/ex-employee|worked with us|worked previously/i.test(lastMsg)) {
              answer = 'No';
            } else if (/relocat/i.test(lastMsg)) {
              answer = 'Yes';
            }

            console.log(`   👉 Typing answer: "${answer}"...`);
            await editable.click({ force: true }).catch(() => {});
            await page.keyboard.type(answer, { delay: 20 });
            // Dispatch input & change events for reactive state update
            await editable.evaluate(el => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }).catch(() => {});
            await randomSleep(600, 1000);

            const sendBtn = page.locator('.sendMsg, .sendMsgbtn_container, .send-btn, button:has-text("Save"), button:has-text("Submit"), [class*="send"]').first();
            if (await sendBtn.isVisible().catch(() => false)) {
              await sendBtn.click({ force: true }).catch(() => {});
            } else {
              await page.keyboard.press('Enter');
            }
            await randomSleep(2000, 3000);
          } else if (hasStandard) {
            const placeholder = ((await standardInput.getAttribute('placeholder').catch(() => '')) || '').toLowerCase();
            let val = 'NA';
            if (/notice/i.test(lastMsg) || /notice/i.test(placeholder)) val = noticeDays;
            else if (/experience|years|yoe/i.test(lastMsg) || /experience|years/i.test(placeholder)) val = totalExp;
            else if (/current.*ctc/i.test(lastMsg) || /current/i.test(placeholder)) val = currentCtc;
            else if (/expected.*ctc|ctc|salary/i.test(lastMsg) || /expected|salary|ctc/i.test(placeholder)) val = expectedCtc;

            console.log(`   👉 Filling input: "${val}"...`);
            await standardInput.fill(val);
            await standardInput.evaluate(el => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }).catch(() => {});
            await randomSleep(500, 1000);

            const submitBtn = page.locator('button:has-text("Save"), button:has-text("Submit"), button:has-text("Next"), .send-btn').first();
            if (await submitBtn.isVisible().catch(() => false)) {
              await submitBtn.click({ force: true }).catch(() => {});
            } else {
              await page.keyboard.press('Enter');
            }
            await randomSleep(2000, 3000);
          }
        }

        // Verify confirmation
        await randomSleep(1500, 2500);
        const currentUrl = page.url();
        const pageBody = await page.locator('body').innerText().catch(() => '');
        const updatedBtnText = (await applyBtn.innerText().catch(() => '')).trim();

        const isSuccess = /saveApply|multiApplyResp/i.test(currentUrl) ||
                          /applied to|applied successfully|application submitted|already applied/i.test(pageBody) ||
                          /applied/i.test(updatedBtnText);

        if (isSuccess) {
          console.log(`✅ [Naukri Applied Successfully] "${job.title}" @ ${job.company}!`);
          recordApplication({
            company: job.company,
            title: job.title,
            url: job.url,
            platform: 'NAUKRI',
            status: 'SUBMITTED',
            notes: 'Naukri 1-Click Auto-Apply (Screening answered)'
          });
          applications.push({
            company: job.company,
            title: job.title,
            url: job.url,
            status: 'SUBMITTED'
          });
        } else {
          if (/daily.*(limit|quota)|reached.*daily.*limit|applied.*maximum.*today/i.test(pageBody)) {
            console.log('🛑 [Naukri Quota] Daily application limit reached on Naukri for today! Stopping gracefully.');
            break;
          }
          console.log(`⚠️ Unconfirmed submission for ${job.company}. Moving to next candidate.`);
        }

        // Human-like pacing pause (6-12s)
        console.log(`⏳ Pacing pause (6-10s)...`);
        await randomSleep(6000, 10000);
      } catch (err) {
        console.warn(`❌ Error applying to ${job.company}: ${err.message}`);
      }
    }

    console.log(`\n🎉 [Naukri Apply Complete] Successfully submitted ${applications.length} applications!`);
  } catch (err) {
    console.error(`[Naukri Auto-Apply Error]:`, err.message);
  } finally {
    await browser.close().catch(() => {});
  }

  return { appliedCount: applications.length, applications };
}
