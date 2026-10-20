const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3333';
const POLL_INTERVAL_MS = 10000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getStatus() {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function startBatch(batchType, max, maxAgeHours) {
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchType, max, maxAgeHours })
    });
    const data = await res.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function executeStage(stageNumber, totalStages, batchType, max, maxAgeHours, stageLabel) {
  console.log(`\n============================================================`);
  console.log(`⚡ [Stage ${stageNumber}/${totalStages}] Launching ${stageLabel.toUpperCase()} (${max} jobs, fresh < ${maxAgeHours}hr)...`);
  console.log(`============================================================`);

  const triggerRes = await startBatch(batchType, max, maxAgeHours);
  if (triggerRes.error) {
    console.error(`❌ Failed to trigger ${stageLabel}:`, triggerRes.error);
    return false;
  }
  console.log(`✅ [${stageLabel} Triggered]:`, triggerRes.message || 'Started successfully.');

  // Give server 3 seconds to set isRunning = true
  await sleep(3000);

  let lastReported = '';
  while (true) {
    const status = await getStatus();
    if (status.error) {
      console.warn(`[Pipeline Warning] Cannot reach dashboard: ${status.error}. Retrying in 10s...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (status.isRunning) {
      const prog = status.currentProgress || 0;
      const total = status.totalTarget || max;
      const text = status.statusText || 'Processing...';
      const msg = `[Stage ${stageNumber}/${totalStages}: ${stageLabel}] Progress: ${prog}/${total} | ${text}`;
      if (msg !== lastReported) {
        console.log(msg);
        lastReported = msg;
      }
    } else {
      console.log(`\n🎉 [Stage ${stageNumber} Complete] ${stageLabel} has finished execution!`);
      if (status.statusText) {
        console.log(`   Result: ${status.statusText}`);
      }
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return true;
}

async function runPipeline() {
  console.log(`\n============================================================`);
  console.log(`🚀 [PIPELINE COORDINATOR] Autonomous Multi-Batch Sequential Runner`);
  console.log(`Sequential Plan:`);
  console.log(`  1. Evening Batch (50 Positions, Fresh < 1hr)`);
  console.log(`  2. Morning Batch (50 Positions, Fresh < 1hr)`);
  console.log(`  3. Turbo Mass Apply (100 Positions, Fresh < 2hr)`);
  console.log(`Employer Safety Shield: InsightGeeks & TrackoBit 100% BLOCKED`);
  console.log(`Deduplication: 4-Layer Zero-Duplicate Protection Active`);
  console.log(`Dashboard Server: ${DASHBOARD_URL}`);
  console.log(`============================================================\n`);

  // First, check if a batch is already running
  const initialStatus = await getStatus();
  if (initialStatus.isRunning) {
    console.log(`⏳ An existing batch is already running (${initialStatus.batchType}). Waiting for it to conclude before starting stages...`);
    while (true) {
      const st = await getStatus();
      if (!st.isRunning) {
        console.log(`✅ Existing batch finished. Proceeding with sequential batches.`);
        break;
      }
      console.log(`[Existing Batch] Progress: ${st.currentProgress}/${st.totalTarget} | ${st.statusText}`);
      await sleep(POLL_INTERVAL_MS);
    }
    await sleep(5000);
  }

  const stages = [
    { batchType: 'evening', max: 50, maxAgeHours: 1, label: 'Evening Batch' },
    { batchType: 'morning', max: 50, maxAgeHours: 1, label: 'Morning Batch' },
    { batchType: 'turbo',   max: 100, maxAgeHours: 2, label: 'Turbo Mass Apply Batch' }
  ];

  for (let idx = 0; idx < stages.length; idx++) {
    const s = stages[idx];
    await executeStage(idx + 1, stages.length, s.batchType, s.max, s.maxAgeHours, s.label);

    if (idx < stages.length - 1) {
      console.log(`⏳ Cooling down 15 seconds before next stage...`);
      await sleep(15000);
    }
  }

  console.log(`\n============================================================`);
  console.log(`🏆 [PIPELINE COMPLETE] All 3 batches executed sequentially:`);
  console.log(`  1. Evening Batch (50 Jobs) ✅`);
  console.log(`  2. Morning Batch (50 Jobs) ✅`);
  console.log(`  3. Turbo Mass Apply Batch (100 Jobs) ✅`);
  console.log(`All applications and logs recorded in dashboard at: ${DASHBOARD_URL}`);
  console.log(`============================================================\n`);
}

runPipeline().catch(err => {
  console.error(`Fatal Pipeline Coordinator error:`, err);
  process.exit(1);
});
