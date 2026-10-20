#!/usr/bin/env node
import 'dotenv/config';

process.on('uncaughtException', err => {
  console.warn(`⚠️ [CLI Process Protected from Uncaught Exception]: ${err.code || err.message}`);
});

process.on('unhandledRejection', reason => {
  console.warn(`⚠️ [CLI Process Protected from Unhandled Rejection]: ${reason?.message || reason}`);
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { loadProfile } from './config.js';
import { createBrowser, randomSleep } from './automation/browser.js';
import { applyToGreenhouse } from './automation/greenhouse.js';
import { applyToLever } from './automation/lever.js';
import { applyToAshby } from './automation/ashby.js';
import { fetchGreenhouseJobs, fetchLeverJobs, fetchAshbyJobs, filterJobsForIndia } from './scrapers/jobFinder.js';
import { searchGlassdoorJobs } from './scrapers/glassdoorScraper.js';
import { resolveCompanyATS } from './scrapers/careerSiteResolver.js';
import { isAlreadyApplied, recordApplication, getApplications } from './tracker.js';
import { startCronDaemon } from './scheduler/cronDaemon.js';
import { runDailyJobHuntAndApply } from './scheduler/dailyRunner.js';
import { startDashboardServer } from './server/dashboardServer.js';
import { fetchRecentRecruiterLeads, getSavedLeads } from './scrapers/recruiterFinder.js';
import { sendColdEmailToRecruiter, sendBatchRecruiterOutreach } from './email/recruiterMailer.js';
import { sendBatchFollowUps, getEligibleFollowUps, getFollowUpHistory } from './email/followUpEngine.js';
import { runNaukriDailyRanker } from './automation/naukriRanker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDIA_COMPANIES_PATH = path.resolve(__dirname, '../config/india_companies.json');

const program = new Command();

program
  .name('job-bot')
  .description('Autonomous AI Job Application Engine for Greenhouse & Lever ATS (Optimized for India)')
  .version('1.0.0');

// Command 1: Apply to a specific URL
program
  .command('apply <url>')
  .description('Autonomously apply to a Greenhouse or Lever job posting')
  .option('--dry-run', 'Fill form and verify without clicking final submit', false)
  .option('--headless', 'Run browser in background without opening window', false)
  .option('--code <code>', '8-character email verification code for Greenhouse')
  .action(async (url, options) => {
    try {
      if (isAlreadyApplied(url) && !options.dryRun) {
        console.log(`[Skip] Already applied to this job: ${url}`);
        return;
      }

      console.log(`\n========================================`);
      console.log(`🤖 Starting Job Application...`);
      console.log(`Target: ${url}`);
      console.log(`Mode: ${options.dryRun ? 'DRY RUN (Preview)' : 'LIVE (Autonomous Submit)'}`);
      console.log(`========================================\n`);

      const profile = loadProfile();
      const { browser, page } = await createBrowser({ headless: options.headless });

      let result = null;
      if (url.includes('greenhouse.io')) {
        result = await applyToGreenhouse(page, url, profile, { dryRun: options.dryRun, verificationCode: options.code });

        if (result && result.needsVerificationCode) {
          console.log(`\n📧 Please check your inbox (${result.email}) for an email from Greenhouse containing an 8-character verification code.`);
          const readline = await import('readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const userCode = await new Promise(resolve => {
            rl.question('👉 Enter 8-character verification code: ', ans => {
              rl.close();
              resolve(ans.trim());
            });
          });

          if (userCode && userCode.length === 8) {
            console.log(`Entering verification code: ${userCode.toUpperCase()}...`);
            for (let i = 0; i < 8; i++) {
              await page.locator(`#security-input-${i}`).fill(userCode.toUpperCase()[i]);
            }
            await randomSleep(1000, 2000);
            const submitButton = page.locator('#submit_app, button[type="submit"], input[type="submit"]').first();
            await submitButton.click();
            await randomSleep(5000, 7000);

            const bodyText = await page.locator('body').innerText();
            const isConfirmed = bodyText.includes('Thank you') || bodyText.includes('Application Submitted') || bodyText.includes('received') || page.url().includes('thank');
            if (isConfirmed) {
              result.success = true;
              console.log('✅ Verification accepted! Application officially submitted.');
            }
          }
        }
      } else if (url.includes('lever.co')) {
        result = await applyToLever(page, url, profile, { dryRun: options.dryRun });
      } else if (url.includes('ashbyhq.com')) {
        result = await applyToAshby(page, url, profile, { dryRun: options.dryRun });
      } else {
        const { applyToJobUrl } = await import('./automation/jobUrlApplier.js');
        await browser.close().catch(() => {});
        result = await applyToJobUrl(url, {
          companyName: options.company,
          jobTitle: options.title,
          headless: options.headless
        });
      }

      if (!options.dryRun && result && result.success) {
        let platform = 'Other';
        if (url.includes('greenhouse')) platform = 'Greenhouse';
        else if (url.includes('lever')) platform = 'Lever';
        else if (url.includes('ashby')) platform = 'Ashby';

        recordApplication({
          company: result.company,
          title: result.title,
          url,
          platform,
          status: 'SUBMITTED'
        });
        console.log(`\n✅ Saved to application history!`);
      } else if (!options.dryRun && result && !result.success) {
        console.warn(`\n⚠️ Application was not finalized: ${result.reason || 'Verification required'}`);
      }

      console.log(`\nDone. Closing browser.`);
      await randomSleep(2000, 3000);
      await browser.close();
    } catch (err) {
      console.error(`\n❌ Application error:`, err.message);
      process.exit(1);
    }
  });

// Command 2: Hunt Jobs across India Tech Companies
program
  .command('hunt-india')
  .description('Find all active roles across top tech employers in India (Remote, Hybrid, On-site)')
  .action(async () => {
    try {
      const profile = loadProfile();
      const companies = JSON.parse(fs.readFileSync(INDIA_COMPANIES_PATH, 'utf-8'));

      console.log(`\n🇮🇳 Scanning active tech employers in India (Remote, Hybrid, On-site)...`);
      console.log(`Target Roles: ${profile.workPreferences.targetRoles.join(', ')}\n`);

      let totalFound = 0;

      for (const comp of companies) {
        let jobs = [];
        if (comp.ats === 'greenhouse') {
          jobs = await fetchGreenhouseJobs(comp.token);
        } else {
          jobs = await fetchLeverJobs(comp.token);
        }

        const matched = filterJobsForIndia(jobs, profile.workPreferences);
        if (matched.length > 0) {
          console.log(`🏢 ${comp.name} (${matched.length} matching jobs in India):`);
          matched.forEach((j, i) => {
            const applied = isAlreadyApplied(j.url) ? ' [ALREADY APPLIED]' : '';
            console.log(`   ${i + 1}. [${j.title}]`);
            console.log(`      📍 Location: ${j.location}${applied}`);
            console.log(`      🔗 Apply URL: ${j.url}\n`);
          });
          totalFound += matched.length;
        }
      }

      console.log(`------------------------------------------------`);
      console.log(`🎯 Total Matching India Roles Found: ${totalFound}`);
      console.log(`Tip: Use 'node src/cli.js apply "<url>"' to apply directly, or 'node src/cli.js auto-apply-india' to batch apply.`);
    } catch (err) {
      console.error('Hunt error:', err.message);
    }
  });

// Command 3: Auto-Apply across India
program
  .command('auto-apply-india')
  .description('Scan and autonomously apply to matching jobs in India')
  .option('--dry-run', 'Preview mode without submitting', false)
  .option('--max <number>', 'Maximum jobs to apply to in this session', '5')
  .action(async (options) => {
    try {
      const profile = loadProfile();
      const companies = JSON.parse(fs.readFileSync(INDIA_COMPANIES_PATH, 'utf-8'));
      const maxApps = parseInt(options.max, 10);
      let appliedCount = 0;

      console.log(`\n🚀 Autonomous India Job Engine Started...`);
      console.log(`Session Cap: ${maxApps} applications`);
      console.log(`Mode: ${options.dryRun ? 'DRY RUN (Preview)' : 'LIVE (Submit)'}\n`);

      const matchingJobs = [];
      for (const comp of companies) {
        let jobs = comp.ats === 'greenhouse' 
          ? await fetchGreenhouseJobs(comp.token) 
          : await fetchLeverJobs(comp.token);

        let filtered = filterJobsForIndia(jobs, profile.workPreferences);
        for (const f of filtered) {
          f.companyName = comp.name;
        }
        matchingJobs.push(...filtered);
      }

      console.log(`Found ${matchingJobs.length} eligible positions across India.`);

      const { browser, page } = await createBrowser({ headless: false });

      for (const job of matchingJobs) {
        if (appliedCount >= maxApps) {
          console.log(`\nReached session limit of ${maxApps} applications.`);
          break;
        }

        if (isAlreadyApplied(job.url)) {
          console.log(`[Skip] Already applied to: ${job.title} at ${job.companyName}`);
          continue;
        }

        console.log(`\n------------------------------------------------`);
        console.log(`Applying to: ${job.title} @ ${job.companyName}`);
        console.log(`Location: ${job.location}`);
        console.log(`URL: ${job.url}`);

        try {
          let res = null;
          if (job.platform === 'greenhouse') {
            res = await applyToGreenhouse(page, job.url, profile, { dryRun: options.dryRun });
          } else {
            res = await applyToLever(page, job.url, profile, { dryRun: options.dryRun });
          }

          if (res && res.success && !options.dryRun) {
            recordApplication({
              company: job.companyName,
              title: job.title,
              url: job.url,
              platform: job.platform,
              status: 'SUBMITTED'
            });
            appliedCount++;
          }

          console.log(`Waiting 20 seconds before next application to simulate human pacing...`);
          await randomSleep(15000, 25000);
        } catch (e) {
          console.error(`Failed to apply to ${job.url}:`, e.message);
        }
      }

      await browser.close();
      console.log(`\n🎉 Completed! Total applications: ${appliedCount}`);
    } catch (err) {
      console.error('Auto-apply error:', err.message);
    }
  });

// Command 4: Application history
program
  .command('history')
  .description('View list of all applied jobs')
  .action(() => {
    const history = getApplications();
    console.log(`\n📋 Application History (${history.length} total):`);
    if (history.length === 0) {
      console.log('No applications recorded yet.');
      return;
    }
    history.forEach((app, idx) => {
      console.log(`${idx + 1}. [${app.status}] ${app.title} @ ${app.company}`);
      console.log(`   Applied At: ${new Date(app.appliedAt).toLocaleString()}`);
      console.log(`   URL: ${app.url}\n`);
    });
  });

// Command 5: Glassdoor Scraper & Career Portal Extractor
program
  .command('glassdoor [query] [location]')
  .description('Search Glassdoor India for jobs and resolve underlying company career portals')
  .option('--limit <number>', 'Maximum jobs to fetch', '15')
  .option('--no-ats', 'Skip ATS resolution')
  .action(async (query, location = 'India', options) => {
    try {
      const actualQuery = query || loadProfile().workPreferences?.targetRoles?.[0] || 'Data Engineer';
      const limit = parseInt(options.limit, 10);
      console.log(`\n🔎 Hunting Glassdoor: "${actualQuery}" in "${location}" (Limit: ${limit})...`);

      const jobs = await searchGlassdoorJobs({
        query: actualQuery,
        location,
        maxResults: limit,
        resolveATS: options.ats !== false,
        headless: true
      });

      console.log(`\n======================================================`);
      console.log(`🎯 Glassdoor Discovered Roles (${jobs.length} found):`);
      console.log(`======================================================\n`);

      jobs.forEach((j, idx) => {
        const atsTag = j.ats && j.ats !== 'Unknown' && j.ats !== 'Direct Career Portal' 
          ? ` [ATS: ${j.ats.toUpperCase()}]` 
          : '';
        console.log(`${idx + 1}. [${j.title}] @ ${j.company}${atsTag}`);
        console.log(`   📍 Location: ${j.location}${j.salary ? ' | 💰 ' + j.salary : ''}`);
        if (j.careerUrl) {
          console.log(`   🏢 Official Career Portal: ${j.careerUrl}`);
        }
        console.log(`   🔗 Glassdoor Link: ${j.glassdoorUrl}`);
        if (j.matchingAtsRoles && j.matchingAtsRoles.length > 0) {
          console.log(`   ⚡ Direct ATS Quick-Apply Link: ${j.matchingAtsRoles[0].url}`);
        }
        console.log('');
      });

      console.log(`💡 Tip: To apply to any detected ATS job, run:`);
      console.log(`   node src/cli.js apply "<Apply_URL>"\n`);
    } catch (err) {
      console.error('Glassdoor command error:', err.message);
    }
  });

// Command 6: Resolve Company ATS & Career Portal
program
  .command('resolve <company>')
  .description('Detect which ATS platform a company uses (Greenhouse, Lever, Ashby) and list open jobs')
  .action(async (company) => {
    try {
      console.log(`\n🔍 Resolving ATS & Career Portal for: "${company}"...`);
      const info = await resolveCompanyATS(company);
      console.log(`\n🏢 Company: ${info.company}`);
      console.log(`📡 Platform: ${info.ats}`);
      if (info.boardUrl) {
        console.log(`🔗 Board URL: ${info.boardUrl}`);
        console.log(`📊 Total Active Postings: ${info.totalJobs}`);
      } else {
        console.log(`ℹ️ Uses custom/direct career portal or private ATS.`);
      }

      if (info.matchingRoles && info.matchingRoles.length > 0) {
        console.log(`\nTop Active Positions:`);
        info.matchingRoles.slice(0, 5).forEach((r, i) => {
          console.log(`  ${i + 1}. ${r.title} (${r.location})`);
          console.log(`     Apply: ${r.url}`);
        });
      }
      console.log('');
    } catch (err) {
      console.error('Resolve error:', err.message);
    }
  });

// Command 7: Hunt Ashby Tech Roles in India
program
  .command('hunt-ashby')
  .description('Scan top tech companies using Ashby ATS for engineering roles in India')
  .action(async () => {
    try {
      const profile = loadProfile();
      const ashbyCompanies = [
        { name: 'Notion', token: 'notion' },
        { name: 'Cursor', token: 'cursor' },
        { name: 'Ramp', token: 'ramp' },
        { name: 'Deel', token: 'deel' },
        { name: 'Linear', token: 'linear' },
        { name: 'Perplexity AI', token: 'perplexity' },
        { name: 'OpenAI', token: 'openai' }
      ];

      console.log(`\n⚡ Scanning Ashby ATS tech employers for India & Remote roles...`);
      let foundCount = 0;

      for (const comp of ashbyCompanies) {
        const jobs = await fetchAshbyJobs(comp.token);
        const matched = filterJobsForIndia(jobs, profile.workPreferences);
        if (matched.length > 0) {
          console.log(`\n🏢 ${comp.name} (${matched.length} matching jobs):`);
          matched.forEach((j, i) => {
            console.log(`   ${i + 1}. [${j.title}]`);
            console.log(`      📍 Location: ${j.location}`);
            console.log(`      🔗 Apply URL: ${j.url}`);
          });
          foundCount += matched.length;
        }
      }

      console.log(`\n🎯 Total Ashby India/Remote Roles Found: ${foundCount}`);
      console.log(`Tip: Apply autonomously with 'node src/cli.js apply "<url>"'\n`);
    } catch (err) {
      console.error('Hunt Ashby error:', err.message);
    }
  });

// Command 8: Start Background Auto-Pilot Scheduler (Cron)
program
  .command('schedule')
  .description('Start the recurring background auto-pilot job application scheduler')
  .option('--cron <expression>', 'Cron schedule expression (default: "0 10 * * *" = 10:00 AM IST daily)', '0 10 * * *')
  .option('--max <number>', 'Maximum applications per cycle', '5')
  .option('--now', 'Run one cycle immediately upon start', false)
  .action((options) => {
    startCronDaemon({
      cronExpression: options.cron,
      dailyMax: parseInt(options.max, 10),
      runImmediately: options.now
    });
  });

// Command 9: Run a Single Auto-Pilot Cycle Immediately
program
  .command('schedule-run-now')
  .description('Execute a single end-to-end daily auto-pilot cycle immediately and send summary email')
  .option('--max <number>', 'Maximum applications for this cycle', '5')
  .option('--headless', 'Run browser in headless mode', false)
  .option('--dry-run', 'Fill form and verify without final submission', false)
  .option('--no-email', 'Skip sending summary email')
  .action(async (options) => {
    try {
      await runDailyJobHuntAndApply({
        dailyMax: parseInt(options.max, 10),
        headless: options.headless,
        dryRun: options.dryRun,
        sendEmail: options.email !== false
      });
    } catch (err) {
      console.error('Schedule run error:', err.message);
    }
  });

// Command 10: Start Web Control Dashboard
program
  .command('dashboard')
  .description('Start the Web Control Dashboard with Morning, Evening, and 100-job click buttons')
  .option('--port <number>', 'Port for dashboard web server', '3333')
  .action((options) => {
    startDashboardServer(parseInt(options.port, 10));
  });

// Command 11: Execute Mass Application Batch (50-100 Jobs)
program
  .command('batch')
  .description('Execute mass application batch prioritizing jobs updated within the last 1 hour')
  .option('--max <number>', 'Number of applications to submit (50-100)', '50')
  .option('--fresh <hours>', 'Prioritize jobs updated within last N hours', '1')
  .option('--headless', 'Run in headless mode', false)
  .option('--dry-run', 'Preview without final submission', false)
  .action(async (options) => {
    try {
      await runDailyJobHuntAndApply({
        dailyMax: parseInt(options.max, 10),
        maxAgeHours: parseFloat(options.fresh),
        headless: options.headless,
        dryRun: options.dryRun,
        sendEmail: true
      });
    } catch (err) {
      console.error('Batch error:', err.message);
    }
  });

// Command 12: Fetch Recruiter Contacts & Emails (< 1hr)
program
  .command('fetch-recruiters [query] [location]')
  .description('Extract recruiter contacts, hiring managers, and emails from recent postings (< 1-24h)')
  .option('--fresh <hours>', 'Max age in hours (default: 1)', '1')
  .option('--max <number>', 'Maximum positions to probe', '15')
  .option('--headless', 'Run in headless mode', true)
  .action(async (query, location = 'India', options) => {
    try {
      const actualQuery = query || loadProfile().workPreferences?.targetRoles?.[0] || 'Data Engineer';
      const leads = await fetchRecentRecruiterLeads({
        query: actualQuery,
        location,
        hours: parseFloat(options.fresh),
        maxResults: parseInt(options.max, 10),
        headless: options.headless
      });

      console.log(`\n======================================================`);
      console.log(`🎯 Recruiter Leads Extracted (${leads.length} new):`);
      console.log(`======================================================\n`);

      leads.forEach((l, i) => {
        console.log(`${i + 1}. ${l.title} @ ${l.company}`);
        console.log(`   👤 Recruiter / Poster: ${l.recruiterName} (${l.recruiterTitle})`);
        console.log(`   ✉️ Contact Email: ${l.targetEmail} [${l.emailType}]`);
        console.log(`   📍 Location: ${l.location} | Posted: ${l.timePosted}`);
        console.log(`   🔗 Job URL: ${l.jobUrl}\n`);
      });

      console.log(`💡 To dispatch personalized cold emails with your resume attached, run:`);
      console.log(`   node src/cli.js send-recruiter-emails --max 5\n`);
    } catch (err) {
      console.error('Fetch recruiters error:', err.message);
    }
  });

// Command 13: Send Personalized Cold Emails to Discovered Recruiters & Hiring Managers
program
  .command('send-recruiter-emails')
  .description('Send personalized cold application emails with latest resume attached to uncontacted recruiters or hiring managers')
  .option('--max <number>', 'Maximum emails to dispatch', '5')
  .option('--type <type>', 'Filter contact type: all, ta, hm', 'all')
  .action(async (options) => {
    try {
      const filterType = options.type.toLowerCase() === 'ta' ? 'TA' : (options.type.toLowerCase() === 'hm' ? 'HIRING_MANAGER' : 'ALL');
      await sendBatchRecruiterOutreach(parseInt(options.max, 10), filterType);
    } catch (err) {
      console.error('Send recruiter emails error:', err.message);
    }
  });

// Command: Deep Upgrade Generic Leads to Real TA & Hiring Managers
program
  .command('upgrade-leads')
  .description('Deep upgrade: scans saved generic careers@ leads and discovers verified Talent Acquisition & Hiring Managers')
  .option('--max <number>', 'Maximum companies to probe', '15')
  .action(async (options) => {
    try {
      const { deepUpgradeGenericLeads } = await import('./scrapers/recruiterFinder.js');
      await deepUpgradeGenericLeads({ maxCompanies: parseInt(options.max, 10) });
    } catch (err) {
      console.error('Upgrade leads error:', err.message);
    }
  });

// Command 14: List Discovered Recruiter Leads
program
  .command('list-leads')
  .description('View all discovered recruiter contacts and outreach statuses')
  .action(() => {
    const leads = getSavedLeads();
    console.log(`\n📋 Saved Recruiter Leads (${leads.length} total):\n`);
    if (leads.length === 0) {
      console.log('No leads saved yet. Run: node src/cli.js fetch-recruiters');
      return;
    }
    leads.forEach((l, i) => {
      const statusIcon = l.status === 'CONTACTED' ? '✅ CONTACTED' : '⏳ UNCONTACTED';
      console.log(`${i + 1}. [${statusIcon}] ${l.title} @ ${l.company}`);
      console.log(`   👤 Contact: ${l.recruiterName} (${l.recruiterTitle})`);
      console.log(`   ✉️ Email: ${l.targetEmail} [${l.emailType}]`);
      console.log(`   📍 Location: ${l.location} | Discovered: ${new Date(l.discoveredAt).toLocaleDateString()}\n`);
    });
  });

// Command 15: Send Threaded Recruiter Follow-Ups (2-3 Days Pacing)
program
  .command('follow-ups')
  .description('Send polite, threaded follow-up emails with resume to recruiters contacted >= 2-3 days ago')
  .option('--max <number>', 'Maximum follow-ups to dispatch', '5')
  .option('--days <number>', 'Minimum days since original outreach', '2')
  .option('--force', 'Force dispatch without minimum age check', false)
  .action(async (options) => {
    try {
      await sendBatchFollowUps({
        maxCount: parseInt(options.max, 10),
        minDays: parseFloat(options.days),
        force: options.force
      });
    } catch (err) {
      console.error('Follow-ups error:', err.message);
    }
  });

// Command 16: List Follow-Up Statuses & Eligible Recruiter Leads
program
  .command('list-follow-ups')
  .description('View sent follow-ups and leads currently eligible for a 30-day notice follow-up nudge')
  .option('--days <number>', 'Minimum days since outreach', '2')
  .action((options) => {
    const minDays = parseFloat(options.days);
    const eligible = getEligibleFollowUps(minDays);
    const history = getFollowUpHistory();

    console.log(`\n======================================================`);
    console.log(`📬 RECRUITER FOLLOW-UP DASHBOARD`);
    console.log(`======================================================`);
    console.log(`Sent Follow-Ups: ${history.length}`);
    console.log(`Eligible for Follow-Up (Sent >= ${minDays} days ago): ${eligible.length}\n`);

    if (eligible.length > 0) {
      console.log(`🎯 Eligible for Follow-Up:`);
      eligible.forEach((e, i) => {
        console.log(`${i + 1}. ${e.title} @ ${e.company}`);
        console.log(`   ✉️ Recipient: ${e.recipientEmail} (${e.recruiterName || 'Hiring Team'})`);
        console.log(`   ⏱️ Sent: ${e.ageDays} days ago (${new Date(e.sentAt).toLocaleDateString()})`);
        console.log(`   🧵 Thread Message ID: ${e.messageId || 'Direct'}\n`);
      });
      console.log(`👉 Run "node src/cli.js follow-ups --max 5" to dispatch threaded follow-ups.\n`);
    }

    if (history.length > 0) {
      console.log(`📜 Recent Follow-Ups Sent (${history.length}):`);
      history.slice(-5).reverse().forEach((h, i) => {
        console.log(`${i + 1}. [FOLLOWED UP] ${h.title} @ ${h.company} (${h.recipientEmail})`);
        console.log(`   Sent At: ${new Date(h.followUpSentAt).toLocaleString()}\n`);
      });
    }
  });

// Command 17: Naukri.com Daily Profile Top-Ranker
program
  .command('naukri-rank')
  .description('Automatically refresh Naukri.com headline and resume upload to rank #1 in recruiter Resdex search')
  .option('--headless', 'Run headless without visible browser window', false)
  .option('--action <action>', 'Action: headline, resume, or all', 'all')
  .action(async (options) => {
    try {
      await runNaukriDailyRanker({
        headless: options.headless,
        action: options.action
      });
    } catch (err) {
      console.error('Naukri ranker error:', err.message);
    }
  });

// Command 18: 30-Minute Continuous Auto-Pilot
program
  .command('autopilot-30m')
  .description('Run continuous 30-minute autopilot: boosts Naukri profile and applies to fresh jobs like a human')
  .action(async () => {
    try {
      const { start30MinAutoPilot } = await import('./scheduler/autopilot30m.js');
      start30MinAutoPilot(true);
    } catch (err) {
      console.error('30m Auto-pilot error:', err.message);
    }
  });

program.parse(process.argv);



