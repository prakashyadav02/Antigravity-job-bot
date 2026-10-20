import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadProfile, isCompanyExcluded } from '../config.js';
import { createBrowser, randomSleep } from '../automation/browser.js';
import { applyToGreenhouse } from '../automation/greenhouse.js';
import { applyToLever } from '../automation/lever.js';
import { applyToAshby } from '../automation/ashby.js';
import { fetchGreenhouseJobs, fetchLeverJobs, fetchAshbyJobs, filterJobsForIndia, sortByFreshness } from '../scrapers/jobFinder.js';
import { isAlreadyApplied, isRoleAlreadyApplied, recordApplication } from '../tracker.js';
import { sendDailySummaryEmail } from '../email/reportMailer.js';
import { waitForConfirmationEmail } from '../email/confirmationVerifier.js';
import { autoDebugAndRemediate } from '../automation/formDebugger.js';
import { fetchAndResolvePortalJobs } from '../scrapers/portalJobScraper.js';
import { applyToNaukriJobs } from '../automation/naukriApplier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDIA_COMPANIES_PATH = path.resolve(__dirname, '../../config/india_companies.json');
const REPORTS_DIR = path.resolve(__dirname, '../../data/reports');

/**
 * Executes an end-to-end mass job application cycle:
 * 1. Scans verified employers across Greenhouse, Lever & Ashby
 * 2. Filters for eligible unapplied engineering roles in India
 * 3. Sorts and prioritizes by freshness (e.g. < 1 hour / today's newest)
 * 4. Autonomously applies up to dailyMax (50-100) with anti-ban pacing
 * 5. Logs to disk and sends daily summary email
 */
export async function runDailyJobHuntAndApply(options = {}) {
  const {
    dailyMax = 50,
    maxAgeHours = 1,
    headless = false,
    sendEmail = true,
    dryRun = false,
    onProgress = null,
    shouldStop = null
  } = options;

  const dateStr = new Date().toISOString().split('T')[0];
  console.log(`\n============================================================`);
  console.log(`🌅 [MASS AUTO-PILOT] Starting automated job cycle for ${dateStr}`);
  console.log(`Target: Up to ${dailyMax} applications | Freshness: Prioritizing < ${maxAgeHours}hr`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (Preview)' : 'LIVE (Submit)'}`);
  console.log(`============================================================\n`);

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const profile = loadProfile();
  const companies = JSON.parse(fs.readFileSync(INDIA_COMPANIES_PATH, 'utf-8'));
  const eligibleJobs = [];
  const seenUrls = new Set();
  // 1. Harvest latest uploaded positions from LinkedIn & Indeed India (< 24h)
  try {
    console.log(`\n🌐 [Portal Harvest] Fetching latest uploaded jobs from LinkedIn & Indeed India...`);
    const portalAtsJobs = await fetchAndResolvePortalJobs({
      query: (profile.workPreferences.targetRoles && profile.workPreferences.targetRoles[0]) || 'Data Engineer',
      location: 'India',
      headless: true
    });
    const matchedPortalJobs = filterJobsForIndia(portalAtsJobs, profile.workPreferences);
    for (const pJob of matchedPortalJobs) {
      const cleanUrl = (pJob.url || '').split('?')[0].toLowerCase().trim();
      if (cleanUrl && !seenUrls.has(cleanUrl) && !isAlreadyApplied(cleanUrl) && !isRoleAlreadyApplied(pJob.companyName, pJob.title)) {
        seenUrls.add(cleanUrl);
        eligibleJobs.push(pJob);
      }
    }
    console.log(`🌐 Added ${matchedPortalJobs.length} fresh engineering roles to candidate pool.\n`);
  } catch (err) {
    console.warn(`[Portal Warning] Could not harvest portal jobs: ${err.message}`);
  }

  // 1b. Harvest Glassdoor India Data Engineer roles
  try {
    console.log(`\n🔍 [Glassdoor Harvest] Checking Glassdoor for fresh Data Engineer roles...`);
    const { searchGlassdoorJobs } = await import('../scrapers/glassdoorScraper.js');
    const gdJobs = await searchGlassdoorJobs({
      query: (profile.workPreferences.targetRoles && profile.workPreferences.targetRoles[0]) || 'Data Engineer',
      location: 'India',
      headless: true,
      maxResults: 15
    });
    for (const gdJob of gdJobs) {
      // STRICT FILTER: Only route to ATS batch if an official supported ATS (Greenhouse, Lever, Ashby) was verified
      const supportedAts = ['greenhouse', 'lever', 'ashby'];
      if (!gdJob.ats || !supportedAts.includes(gdJob.ats.toLowerCase())) {
        // Arbitrary external company sites do not have ATS runners and won't send confirmation receipts
        continue;
      }

      // If matching ATS roles were directly extracted from their board, use them
      if (Array.isArray(gdJob.matchingAtsRoles) && gdJob.matchingAtsRoles.length > 0) {
        for (const role of gdJob.matchingAtsRoles) {
          const cleanUrl = (role.url || '').split('?')[0].toLowerCase().trim();
          if (cleanUrl && !seenUrls.has(cleanUrl) && !isAlreadyApplied(cleanUrl) && !isRoleAlreadyApplied(gdJob.company, role.title)) {
            seenUrls.add(cleanUrl);
            eligibleJobs.push({
              title: role.title,
              companyName: gdJob.company,
              url: role.url,
              platform: gdJob.ats.toLowerCase(),
              location: role.location || gdJob.location,
              ageHours: 1.0,
              isFreshToday: true
            });
          }
        }
      } else if (gdJob.careerUrl) {
        const atsUrl = gdJob.careerUrl;
        const cleanUrl = (atsUrl || '').split('?')[0].toLowerCase().trim();
        if (cleanUrl && !seenUrls.has(cleanUrl) && !isAlreadyApplied(cleanUrl) && !isRoleAlreadyApplied(gdJob.company, gdJob.title)) {
          seenUrls.add(cleanUrl);
          eligibleJobs.push({
            title: gdJob.title,
            companyName: gdJob.company,
            url: atsUrl,
            platform: gdJob.ats.toLowerCase(),
            location: gdJob.location || 'India',
            ageHours: 1.0,
            isFreshToday: true
          });
        }
      }
    }
    console.log(`🔍 [Glassdoor Harvest] Added ${eligibleJobs.filter(j => ['greenhouse', 'lever', 'ashby'].includes(j.platform)).length} verified ATS roles.\n`);
  } catch (err) {
    console.warn(`[Glassdoor Warning] Could not harvest Glassdoor jobs: ${err.message}`);
  }


  console.log(`🔍 Scanning ${companies.length} top tech employers across India...`);

  const chunkSize = 15;
  for (let i = 0; i < companies.length; i += chunkSize) {
    if (shouldStop && shouldStop()) {
      console.log('🛑 Scan stopped by user.');
      break;
    }
    const chunk = companies.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (emp) => {
      try {
        let rawJobs = [];
        if (emp.ats === 'greenhouse') {
          rawJobs = await fetchGreenhouseJobs(emp.token);
        } else if (emp.ats === 'lever') {
          rawJobs = await fetchLeverJobs(emp.token);
        } else if (emp.ats === 'ashby') {
          rawJobs = await fetchAshbyJobs(emp.token);
        }

        const filtered = filterJobsForIndia(rawJobs, profile.workPreferences);
        for (const job of filtered) {
          const cleanUrl = (job.url || '').split('?')[0].toLowerCase().trim();
          if (
            cleanUrl &&
            !seenUrls.has(cleanUrl) &&
            !isAlreadyApplied(cleanUrl) &&
            !isRoleAlreadyApplied(emp.name, job.title)
          ) {
            seenUrls.add(cleanUrl);
            job.companyName = emp.name;
            eligibleJobs.push(job);
          }
        }
      } catch (e) {}
    }));
  }

  const successfulApps = [];
  const failedApps = [];
  let wasHalted = false;

  // Phase 1: Apply to unapplied Data Engineer jobs on Naukri (2-5 YOE)
  try {
    console.log(`\n============================================================`);
    console.log(`📌 [Naukri 1-Click Engine] Auto-Applying to 2-5 YOE Roles...`);
    console.log(`============================================================`);
    const naukriResult = await applyToNaukriJobs({
      maxApplications: Math.min(dailyMax, 25),
      headless: true
    });

    if (naukriResult && naukriResult.applications?.length > 0) {
      successfulApps.push(...naukriResult.applications);
      console.log(`✅ [Naukri Batch] Successfully submitted ${naukriResult.applications.length} applications.`);
      if (onProgress) {
        onProgress({
          index: successfulApps.length,
          total: dailyMax,
          job: naukriResult.applications[naukriResult.applications.length - 1],
          status: 'SUCCESS',
          message: `Naukri 1-Click: Applied to ${naukriResult.applications.length} jobs`
        });
      }
    }
  } catch (err) {
    console.warn(`[Naukri Apply Warning]: ${err.message}`);
  }

  // Phase 1b: Apply to unapplied Data Engineer roles on LinkedIn Easy-Apply (if session state exists)
  try {
    const remainingForLinkedin = Math.min(5, dailyMax - successfulApps.length);
    if (remainingForLinkedin > 0) {
      console.log(`\n============================================================`);
      console.log(`📌 [LinkedIn Easy-Apply Engine] Checking unapplied 2-5 YOE roles...`);
      console.log(`============================================================`);
      const { applyToLinkedInJobs } = await import('../automation/linkedinApplier.js');
      const linkedinResult = await applyToLinkedInJobs({
        maxApplications: remainingForLinkedin,
        headless: true
      });
      if (linkedinResult && linkedinResult.applications?.length > 0) {
        successfulApps.push(...linkedinResult.applications);
        console.log(`✅ [LinkedIn Batch] Successfully submitted ${linkedinResult.applications.length} applications.`);
      }
    }
  } catch (err) {
    console.warn(`[LinkedIn Apply Warning]: ${err.message}`);
  }


  console.log(`🎯 Discovered ${eligibleJobs.length} eligible, unapplied ATS roles in India.`);

  if (eligibleJobs.length === 0) {
    console.log('ℹ️ No new unapplied direct ATS portal jobs found right now.');
    if (successfulApps.length === 0) {
      const emptyReport = { date: dateStr, appliedCount: 0, applications: [], failed: [] };
      if (sendEmail) await sendDailySummaryEmail(emptyReport);
      return emptyReport;
    }
  }

  // Phase 2: Sort and apply to direct ATS portal jobs (Greenhouse, Lever, Ashby)
  const remainingMax = Math.max(0, dailyMax - successfulApps.length);
  const sortedJobs = sortByFreshness(eligibleJobs, maxAgeHours);
  const targetBatch = sortedJobs.slice(0, remainingMax);

  if (targetBatch.length > 0) {
    console.log(`\n🚀 Applying to top ${targetBatch.length} ATS jobs (Prioritizing newest)...`);
    const fresh1hCount = targetBatch.filter(j => j.ageHours <= 1.0).length;
    console.log(`⚡ Fresh within 1 hour: ${fresh1hCount} jobs | Rest: Today's newest postings\n`);

    const { browser, page } = await createBrowser({ headless });

    for (let i = 0; i < targetBatch.length; i++) {
      if (shouldStop && shouldStop()) {
        console.log('🛑 [Stop Signal] Batch execution stopped by user.');
        break;
      }

      const job = targetBatch[i];
    
    // Safety Shield: Guarantee current employer & affiliated entities are NEVER touched
    if (isCompanyExcluded(job.companyName || job.company, job.url)) {
      console.warn(`\n🛡️ [SAFETY SHIELD] Blocked application to excluded employer: "${job.companyName}" (${job.url})`);
      continue;
    }

    // Deduplication Shield: Double check if already applied or attempted recently
    if (isAlreadyApplied(job.url) || isRoleAlreadyApplied(job.companyName, job.title)) {
      console.log(`\n⏭️ [Skip Duplicate] Already applied previously to "${job.title}" @ ${job.companyName}`);
      continue;
    }

    const ageTag = job.ageHours <= 1.0 ? '⚡ <1h' : `${job.ageHours}h ago`;
    console.log(`\n------------------------------------------------------------`);
    console.log(`[Job ${i + 1}/${targetBatch.length}] [${ageTag}] Applying to: "${job.title}" @ ${job.companyName}`);
    console.log(`Location: ${job.location}`);
    console.log(`URL: ${job.url}`);

    if (onProgress) {
      onProgress({
        index: i + 1,
        total: targetBatch.length,
        job,
        status: 'APPLYING',
        message: `[${i + 1}/${targetBatch.length}] Applying to ${job.title} @ ${job.companyName} (${ageTag})`
      });
    }

    try {
      const platformLower = (job.platform || '').toLowerCase();
      if (!['greenhouse', 'lever', 'ashby'].includes(platformLower)) {
        console.log(`ℹ️ [Skip Non-ATS] "${job.platform}" is not a supported direct ATS. Skipping.`);
        continue;
      }

      const submitStartTime = Date.now();
      let result = null;
      if (platformLower === 'greenhouse') {
        result = await applyToGreenhouse(page, job.url, profile, { dryRun });
      } else if (platformLower === 'lever') {
        result = await applyToLever(page, job.url, profile, { dryRun });
      } else if (platformLower === 'ashby') {
        result = await applyToAshby(page, job.url, profile, { dryRun });
      }

      if (result && result.success) {
        if (dryRun) {
          const record = {
            company: job.companyName,
            title: job.title,
            url: job.url,
            platform: job.platform.toUpperCase(),
            status: 'PREVIEW_ONLY',
            ageHours: job.ageHours
          };
          successfulApps.push(record);
          console.log(`✅ [Preview] Form pre-filled for ${job.companyName}!`);
        } else {
          // STEP 1: FAST ON-SCREEN ATS CONFIRMATION CHECK (Immediate Portal Feedback)
          console.log(`\n⏳ Checking on-screen ATS confirmation for ${job.companyName}...`);
          await page.waitForTimeout(3000); // Allow ATS 3s to redirect or update DOM
          const bodyText = await page.locator('body').innerText().catch(() => '');
          const pageUrlLower = page.url().toLowerCase();
          const isConfirmedOnScreen = 
            bodyText.includes('Thank you') || 
            bodyText.includes('Thanks for applying') || 
            bodyText.includes('Application Submitted') || 
            bodyText.includes('Application submitted') || 
            bodyText.includes('received your application') || 
            bodyText.includes('We have received your application') ||
            pageUrlLower.includes('thank') || 
            pageUrlLower.includes('confirmation') ||
            pageUrlLower.includes('submitted');

          if (isConfirmedOnScreen) {
            console.log(`🎉 [ATS ON-SCREEN CONFIRMED] Official success screen confirmed for ${job.companyName}!`);
            console.log(`   Portal Message: "Thanks for applying!"\n`);

            const record = {
              company: job.companyName,
              title: job.title,
              url: job.url,
              platform: job.platform.toUpperCase(),
              status: 'VERIFIED_SUBMITTED',
              confirmationSubject: 'On-Screen ATS Confirmation ("Thanks for applying!")',
              confirmedAt: new Date().toISOString(),
              ageHours: job.ageHours
            };
            recordApplication(record);
            successfulApps.push(record);

            if (onProgress) {
              onProgress({
                index: i + 1,
                total: targetBatch.length,
                job,
                status: 'SUCCESS',
                message: `Verified On-Screen: "Thanks for applying!" @ ${job.companyName}`
              });
            }
          } else {
            // STEP 2: FALLBACK TO EMAIL VERIFICATION GATE
            console.log(`⏳ On-screen confirmation pending. Checking confirmation email for ${job.companyName}...`);
            if (onProgress) {
              onProgress({
                index: i + 1,
                total: targetBatch.length,
                job,
                status: 'VERIFYING_EMAIL',
                message: `[${i + 1}/${targetBatch.length}] Submitted! Checking email confirmation from ${job.companyName}...`
              });
            }

            const emailCheck = await waitForConfirmationEmail({
              companyName: job.companyName || job.company,
              jobTitle: job.title,
              submittedAfter: submitStartTime,
              timeoutSeconds: 20
            });

            if (emailCheck.confirmed) {
              console.log(`🎉 [EMAIL VERIFIED] Official confirmation received from ${job.companyName}!`);
              console.log(`   Subject: "${emailCheck.subject}"`);
              console.log(`   From: ${emailCheck.from}\n`);

              const record = {
                company: job.companyName,
                title: job.title,
                url: job.url,
                platform: job.platform.toUpperCase(),
                status: 'VERIFIED_SUBMITTED',
                confirmationSubject: emailCheck.subject,
                confirmedAt: emailCheck.receivedAt,
                ageHours: job.ageHours
              };
              recordApplication(record);
              successfulApps.push(record);

              if (onProgress) {
                onProgress({
                  index: i + 1,
                  total: targetBatch.length,
                  job,
                  status: 'SUCCESS',
                  message: `Verified by Email: "${emailCheck.subject}" @ ${job.companyName}`
                });
              }
            } else {
              console.warn(`\n⚠️ [Receipt Missing] Confirmation email not yet received from ${job.companyName}.`);
              console.log(`🔍 [Triggering Auto-Debugger] Investigating root cause and applying self-healing fixes...`);

              if (onProgress) {
                onProgress({
                  index: i + 1,
                  total: targetBatch.length,
                  job,
                  status: 'AUTO_DEBUGGING',
                  message: `[Auto-Debugger] Investigating & fixing submission for ${job.companyName}...`
                });
              }

              const debugResult = await autoDebugAndRemediate(page, job, profile, { timeoutSeconds: 45 });

              if (debugResult.confirmed) {
                console.log(`🎉 [AUTO-DEBUG RESOLVED] Problem diagnosed & fixed! Confirmation received from ${job.companyName}!`);
                console.log(`   Subject: "${debugResult.subject}"`);
                console.log(`   From: ${debugResult.from}\n`);

                const record = {
                  company: job.companyName,
                  title: job.title,
                  url: job.url,
                  platform: job.platform.toUpperCase(),
                  status: 'VERIFIED_SUBMITTED',
                  confirmationSubject: debugResult.subject,
                  confirmedAt: debugResult.receivedAt,
                  ageHours: job.ageHours,
                  debugResolved: true
                };
                recordApplication(record);
                successfulApps.push(record);

                if (onProgress) {
                  onProgress({
                    index: i + 1,
                    total: targetBatch.length,
                    job,
                    status: 'SUCCESS',
                    message: `Auto-Fixed & Verified: "${debugResult.subject}" @ ${job.companyName}`
                  });
                }
              } else {
                console.warn(`\n⚠️ [Application Skipped] Submission could not be confirmed for ${job.companyName}.`);
                console.warn(`Saving debug artifacts and proceeding to next job in batch...\n`);

                const record = {
                  company: job.companyName,
                  title: job.title,
                  url: job.url,
                  platform: job.platform.toUpperCase(),
                  status: 'SKIPPED_UNCONFIRMED',
                  error: debugResult.error,
                  issues: debugResult.issues,
                  screenshot: debugResult.screenshotPath,
                  ageHours: job.ageHours
                };
                recordApplication(record);
                failedApps.push({
                  company: job.companyName,
                  title: job.title,
                  url: job.url,
                  reason: `No confirmation receipt after debugging: ${debugResult.error}`
                });

                if (onProgress) {
                  onProgress({
                    index: i + 1,
                    total: targetBatch.length,
                    job,
                    status: 'SKIPPED',
                    message: `Skipped ${job.companyName} (Unconfirmed). Continuing batch...`
                  });
                }
              }
            }
          }
        }
      } else {
        console.warn(`\n⚠️ [Submission Incomplete] Initial submit attempt did not finish for ${job.companyName}.`);
        console.log(`🔍 [Triggering Auto-Debugger] Investigating form errors and self-healing...`);

        const debugResult = await autoDebugAndRemediate(page, job, profile, { timeoutSeconds: 90 });

        if (debugResult.confirmed) {
          console.log(`🎉 [AUTO-DEBUG RESOLVED] Problem diagnosed & fixed! Confirmation received from ${job.companyName}!`);
          const record = {
            company: job.companyName,
            title: job.title,
            url: job.url,
            platform: job.platform.toUpperCase(),
            status: 'VERIFIED_SUBMITTED',
            confirmationSubject: debugResult.subject,
            confirmedAt: debugResult.receivedAt,
            ageHours: job.ageHours,
            debugResolved: true
          };
          recordApplication(record);
          successfulApps.push(record);
        } else {
          console.warn(`⚠️ [Application Skipped] Submission could not be confirmed for ${job.companyName}.`);
          console.warn(`Recording skip status to database to avoid retrying on future runs...\n`);

          const record = {
            company: job.companyName,
            title: job.title,
            url: job.url,
            platform: (job.platform || 'ATS').toUpperCase(),
            status: 'SKIPPED_UNCONFIRMED',
            error: debugResult.error || 'Submission failed and confirmation not received',
            ageHours: job.ageHours
          };
          recordApplication(record);

          failedApps.push({
            company: job.companyName,
            title: job.title,
            url: job.url,
            reason: debugResult.error || 'Submission failed and confirmation not received'
          });
          if (onProgress) {
            onProgress({
              index: i + 1,
              total: targetBatch.length,
              job,
              status: 'SKIPPED',
              message: `Skipped ${job.companyName} (${debugResult.error || 'Unconfirmed'}). Continuing batch...`
            });
          }
        }
      }

      // Safe high-efficiency pacing interval (6–8s) to prevent any rate-limiting
      if (i < targetBatch.length - 1 && !(shouldStop && shouldStop())) {
        console.log('⏳ Waiting 6-8 seconds before next application to simulate human pacing...');
        await randomSleep(6000, 8000);
      }
    } catch (err) {
      console.error(`❌ [Error applying to ${job.companyName}]:`, err.message);
      recordApplication({
        company: job.companyName,
        title: job.title,
        url: job.url,
        platform: (job.platform || 'ATS').toUpperCase(),
        status: 'SKIPPED_UNCONFIRMED',
        error: err.message,
        ageHours: job.ageHours
      });
      failedApps.push({
        company: job.companyName,
        title: job.title,
        url: job.url,
        reason: err.message
      });
    }
  }
  await browser.close().catch(() => {});
}

  const report = {
    date: dateStr,
    timestamp: new Date().toISOString(),
    appliedCount: successfulApps.length,
    applications: successfulApps,
    failed: failedApps,
    halted: wasHalted
  };

  const reportPath = path.join(REPORTS_DIR, `daily_report_${dateStr}_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 [Report] Saved execution report to: ${reportPath}`);

  if (sendEmail && successfulApps.length > 0) {
    console.log(`📧 Sending summary email to ${profile.personal.email}...`);
    await sendDailySummaryEmail(report);
  }

  console.log(`\n🎉 [CYCLE FINISHED] Submitted: ${successfulApps.length} | Skipped: ${failedApps.length}\n`);
  return report;
}
