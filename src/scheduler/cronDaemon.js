import cron from 'node-cron';
import { runDailyJobHuntAndApply } from './dailyRunner.js';

/**
 * Starts the persistent background cron scheduler.
 * Default: Runs everyday at 10:00 AM IST ('0 10 * * *')
 */
export function startCronDaemon(options = {}) {
  const {
    cronExpression = '0 * * * *',
    dailyMax = 10,
    runImmediately = false
  } = options;

  console.log(`\n============================================================`);
  console.log(`🤖 JOB BOT AUTO-PILOT HOURLY SCHEDULER ACTIVE`);
  console.log(`Schedule: "${cronExpression}" (Runs automatically every 1 hour)`);
  console.log(`Session Limit: Up to ${dailyMax} applications/cycle`);
  console.log(`Email Reports: Enabled (sent to your Gmail after each run)`);
  console.log(`============================================================\n`);

  if (!cron.validate(cronExpression)) {
    console.error(`❌ Invalid cron expression: "${cronExpression}"`);
    process.exit(1);
  }

  let isRunning = false;

  const task = async () => {
    if (isRunning) {
      console.log('⚠️ Previous job cycle is still in progress. Skipping trigger.');
      return;
    }
    isRunning = true;
    try {
      console.log(`\n⏰ [HOURLY CRON TRIGGER] Scheduled execution initiated at ${new Date().toLocaleString()}...`);
      await runDailyJobHuntAndApply({ dailyMax, headless: true, sendEmail: true });

      // Automatically dispatch fresh recruiter outreach
      try {
        const { sendBatchRecruiterOutreach } = await import('../email/recruiterMailer.js');
        await sendBatchRecruiterOutreach(3);
      } catch (e) {
        console.warn(`[Recruiter Outreach in Cron]: ${e.message}`);
      }
    } catch (err) {
      console.error('❌ [Scheduler Run Error]:', err.message);
    } finally {
      isRunning = false;
      console.log(`\n💤 Waiting for next scheduled trigger: "${cronExpression}"...`);
    }
  };

  cron.schedule(cronExpression, task, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  console.log(`✅ Cron worker successfully registered for timezone Asia/Kolkata.`);
  console.log(`Process running in background. Press Ctrl+C to terminate.\n`);

  if (runImmediately) {
    console.log(`🚀 Executing immediate first cycle as requested...`);
    task();
  }
}
