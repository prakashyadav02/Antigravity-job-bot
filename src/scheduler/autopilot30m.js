import { runNaukriDailyRanker } from '../automation/naukriRanker.js';
import { applyToNaukriJobs } from '../automation/naukriApplier.js';
import { randomSleep } from '../automation/browser.js';
import { fetchRecentRecruiterLeads } from '../scrapers/recruiterFinder.js';
import { sendBatchRecruiterOutreach } from '../email/recruiterMailer.js';

let autopilotState = {
  isActive: false,
  intervalTimer: null,
  isCycleRunning: false,
  lastRunAt: null,
  nextRunAt: null,
  cycleCount: 0,
  currentStatus: 'Idle',
  lastSummary: null
};

let externalLogFn = console.log;

export function setAutoPilotLogger(logFn) {
  if (typeof logFn === 'function') {
    externalLogFn = logFn;
  }
}

function log(msg) {
  externalLogFn(`[30m Auto-Pilot] ${msg}`);
}

/**
 * Executes a single human-paced 30-minute cycle:
 * 1. Boosts Naukri profile timestamp & SEO headline (Page 1 Resdex rank)
 * 2. Applies to 3 fresh 2-5 YOE Data Engineer postings on Naukri (human pacing 6-12s)
 * 3. Scans fresh recruiter leads & sends personalized cold emails
 */
export async function runSingleCycle() {
  if (autopilotState.isCycleRunning) {
    log('Previous cycle is still running. Skipping overlapping trigger.');
    return;
  }

  autopilotState.isCycleRunning = true;
  autopilotState.currentStatus = 'Running cycle...';
  const cycleNumber = autopilotState.cycleCount + 1;
  log(`🚀 Starting Auto-Pilot Cycle #${cycleNumber}...`);

  let rankerStatus = 'SKIPPED';
  let appliedCount = 0;
  let emailsSent = 0;

  try {
    // 1. Naukri Profile Boost (Update timestamp & headline to stay "Active Just Now")
    try {
      log('Step 1/3: Boosting Naukri profile (Active Today & Resdex #1 SEO)...');
      const rankResult = await runNaukriDailyRanker({ headless: true, action: 'all' });
      rankerStatus = rankResult.status || 'DONE';
      log(`✅ Profile boost complete: ${rankerStatus}`);
    } catch (e) {
      log(`⚠️ Profile boost warning: ${e.message}`);
    }

    // Human-like pause between tasks
    log('⏳ Human pause (8s)...');
    await randomSleep(7000, 10000);

    // 2. Naukri & Career Sites Apply to fresh Data Engineer jobs (0-5 YOE)
    try {
      log('Step 2/3: Applying to fresh 0-5 YOE Data Engineer jobs on Naukri & Career Sites...');
      const applyResult = await applyToNaukriJobs({
        maxApplications: 8,
        dailyMax: false,
        allowCareerSites: true,
        minExp: 0,
        maxExp: 5,
        headless: true
      });
      appliedCount = applyResult.appliedCount || 0;
      log(`✅ Naukri & Career Site apply complete: ${appliedCount} new applications submitted.`);
    } catch (e) {
      log(`⚠️ Naukri apply warning: ${e.message}`);
    }

    // Human-like pause between tasks
    log('⏳ Human pause (10s)...');
    await randomSleep(9000, 12000);

    // 3. Multi-Platform Recruiter Lead Scraping & Tailored Cold Outreach
    try {
      log('Step 3/3: Scraping fresh recruiter emails across LinkedIn & Naukri + sending tailored outreach...');
      const { fetchAllPlatformsRecruiterLeads } = await import('../scrapers/recruiterFinder.js');
      await fetchAllPlatformsRecruiterLeads({ query: 'Data Engineer', hours: 24, maxResults: 15, headless: true });
      const outreachRes = await sendBatchRecruiterOutreach(3);
      emailsSent = Array.isArray(outreachRes) ? outreachRes.length : (outreachRes.sentCount || 0);
      log(`✅ Outreach complete: ${emailsSent} tailored cold emails sent with resume attached.`);
    } catch (e) {
      log(`ℹ️ Recruiter check info: ${e.message}`);
    }

    autopilotState.cycleCount++;
    autopilotState.lastRunAt = new Date().toISOString();
    autopilotState.lastSummary = `Cycle #${cycleNumber}: Profile Boosted (${rankerStatus}), ${appliedCount} Naukri applications, ${emailsSent} cold emails.`;
    autopilotState.currentStatus = `Idle. Last cycle completed at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`;
    log(`🎉 Cycle #${cycleNumber} finished successfully! Next run in 30 minutes.`);
  } catch (err) {
    autopilotState.currentStatus = `Error in cycle: ${err.message}`;
    log(`❌ Cycle error: ${err.message}`);
  } finally {
    autopilotState.isCycleRunning = false;
  }
}

/**
 * Starts the recurring 30-minute Auto-Pilot loop
 */
export function start30MinAutoPilot(runImmediate = true) {
  if (autopilotState.isActive) {
    return { success: false, message: '30-minute Auto-Pilot is already running.' };
  }

  autopilotState.isActive = true;
  autopilotState.currentStatus = 'Auto-Pilot active. Next run in 30 minutes.';
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  autopilotState.nextRunAt = new Date(Date.now() + INTERVAL_MS).toISOString();

  autopilotState.intervalTimer = setInterval(() => {
    autopilotState.nextRunAt = new Date(Date.now() + INTERVAL_MS).toISOString();
    runSingleCycle();
  }, INTERVAL_MS);

  log('✅ 30-Minute Auto-Pilot Scheduler started (30m interval).');

  if (runImmediate) {
    log('⚡ Launching initial cycle immediately...');
    runSingleCycle();
  }

  return { success: true, message: '30-Minute Auto-Pilot started successfully.' };
}

/**
 * Stops the recurring 30-minute Auto-Pilot loop
 */
export function stop30MinAutoPilot() {
  if (!autopilotState.isActive) {
    return { success: false, message: '30-minute Auto-Pilot is not active.' };
  }

  if (autopilotState.intervalTimer) {
    clearInterval(autopilotState.intervalTimer);
    autopilotState.intervalTimer = null;
  }

  autopilotState.isActive = false;
  autopilotState.nextRunAt = null;
  autopilotState.currentStatus = 'Stopped by user.';
  log('🛑 30-Minute Auto-Pilot stopped.');

  return { success: true, message: '30-Minute Auto-Pilot stopped.' };
}

export function getAutoPilotStatus() {
  let msUntilNext = 0;
  if (autopilotState.isActive && autopilotState.nextRunAt) {
    msUntilNext = Math.max(0, new Date(autopilotState.nextRunAt).getTime() - Date.now());
  }

  return {
    isActive: autopilotState.isActive,
    isCycleRunning: autopilotState.isCycleRunning,
    lastRunAt: autopilotState.lastRunAt,
    nextRunAt: autopilotState.nextRunAt,
    secondsUntilNext: Math.round(msUntilNext / 1000),
    cycleCount: autopilotState.cycleCount,
    currentStatus: autopilotState.currentStatus,
    lastSummary: autopilotState.lastSummary
  };
}
