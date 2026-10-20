import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDailyJobHuntAndApply } from '../scheduler/dailyRunner.js';
import { getApplications } from '../tracker.js';
import { fetchRecentRecruiterLeads, getSavedLeads } from '../scrapers/recruiterFinder.js';
import { sendColdEmailToRecruiter, sendBatchRecruiterOutreach } from '../email/recruiterMailer.js';
import { sendBatchFollowUps, getEligibleFollowUps, getFollowUpHistory } from '../email/followUpEngine.js';
import { runNaukriDailyRanker, getNaukriRankLogs, launchNaukriLoginWindow, isNaukriSessionSaved } from '../automation/naukriRanker.js';
import { loadProfile } from '../config.js';
import { start30MinAutoPilot, stop30MinAutoPilot, getAutoPilotStatus, setAutoPilotLogger } from '../scheduler/autopilot30m.js';
import { getFullSettings, saveFullSettings } from '../utils/settingsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APPLIED_JOBS_PATH = path.resolve(__dirname, '../../data/applied_jobs.json');

let state = {
  isRunning: false,
  batchType: 'none',
  currentProgress: 0,
  totalTarget: 0,
  currentJob: null,
  statusText: 'Idle. Ready to launch batch.',
  logs: [],
  recentApplications: [],
  shouldStop: false,
  isFetchingLeads: false,
  isSendingFollowUps: false,
  isRankingNaukri: false
};

function addLog(msg) {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  const entry = `[${time}] ${msg}`;
  state.logs.push(entry);
  if (state.logs.length > 250) state.logs.shift();
  console.log(entry);
}

setAutoPilotLogger(addLog);

// Global safety net to prevent transient socket drops (e.g. ECONNABORTED) from crashing the server
process.on('uncaughtException', err => {
  console.warn(`⚠️ [Server Protected from Uncaught Exception]: ${err.code || err.message}`);
});

process.on('unhandledRejection', reason => {
  console.warn(`⚠️ [Server Protected from Unhandled Rejection]: ${reason?.message || reason}`);
});

export function startDashboardServer(port = 3333) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // API: Status
    if (req.method === 'GET' && url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      const history = getApplications();
      const leads = getSavedLeads();
      const eligibleFollowUps = getEligibleFollowUps(2);
      const followUpHistory = getFollowUpHistory();
      const naukriLogs = getNaukriRankLogs();

      const taLeadsCount = leads.filter(l => l.contactType === 'TALENT_ACQUISITION' || /talent|recruiter|hr|ta|people/i.test(l.recruiterTitle || '')).length;
      const hmLeadsCount = leads.filter(l => l.contactType === 'HIRING_MANAGER' || /manager|lead|director|vp|head|architect/i.test(l.recruiterTitle || '')).length;
      const genericLeadsCount = leads.filter(l => (l.targetEmail || '').startsWith('careers@') || (l.targetEmail || '').startsWith('hr@')).length;

      let isLinkedInAuth = false;
      try {
        const { isLinkedInSessionActive } = await import('../scrapers/recruiterFinder.js');
        isLinkedInAuth = isLinkedInSessionActive();
      } catch {
        isLinkedInAuth = fs.existsSync(path.resolve(__dirname, '../../data/linkedin_storage_state.json'));
      }

      res.end(JSON.stringify({
        ...state,
        totalLifetimeApplied: history.length,
        totalLeadsCount: leads.length,
        uncontactedLeadsCount: leads.filter(l => l.status === 'UNCONTACTED').length,
        taLeadsCount,
        hmLeadsCount,
        genericLeadsCount,
        eligibleFollowUpsCount: eligibleFollowUps.length,
        sentFollowUpsCount: followUpHistory.length,
        naukriLastRank: naukriLogs[naukriLogs.length - 1] || null,
        isNaukriSessionSaved: isNaukriSessionSaved(),
        hasNaukriPassword: !!process.env.NAUKRI_PASSWORD,
        isLinkedInSessionSaved: isLinkedInAuth,
        autopilot: getAutoPilotStatus(),
        historySlice: history.slice(-10).reverse()
      }));
      return;
    }

    // API: Leads List
    if (req.method === 'GET' && url.pathname === '/api/leads') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(getSavedLeads()));
      return;
    }

    // API: Fetch Fresh Recruiter Leads
    if (req.method === 'POST' && url.pathname === '/api/leads/fetch') {
      if (state.isFetchingLeads) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Lead fetch already in progress.' }));
        return;
      }

      state.isFetchingLeads = true;
      addLog('🔍 Started searching for fresh recruiter postings (< 1hr)...');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Recruiter lead hunt started.' }));

      (async () => {
        try {
          const prof = loadProfile();
          const targetRole = prof.workPreferences?.targetRoles?.[0] || 'Data Engineer';
          const { fetchAllPlatformsRecruiterLeads } = await import('../scrapers/recruiterFinder.js');
          const leads = await fetchAllPlatformsRecruiterLeads({
            query: targetRole,
            hours: 24,
            maxResults: 20,
            headless: true
          });
          addLog(`✅ Extracted ${leads.length} fresh recruiter contacts across LinkedIn & Naukri!`);
        } catch (e) {
          addLog(`❌ Failed to fetch recruiter leads: ${e.message}`);
        } finally {
          state.isFetchingLeads = false;
        }
      })();
      return;
    }

    // API: Send Email to Recruiter
    if (req.method === 'POST' && url.pathname === '/api/leads/email') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        let params = {};
        try { params = JSON.parse(body); } catch {}

        if (params.batch) {
          const filterType = params.filterType || 'ALL';
          const maxCount = params.max || 5;
          const label = filterType === 'TA' ? 'Talent Acquisition leads' : (filterType === 'HIRING_MANAGER' ? 'Hiring Managers' : 'recruiter leads');
          addLog(`📬 Sending cold emails to up to ${maxCount} ${label}...`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, message: `Batch email outreach for ${label} dispatched.` }));
          sendBatchRecruiterOutreach(maxCount, filterType).catch(e => addLog(`❌ Outreach error: ${e.message}`));
          return;
        }

        const leads = getSavedLeads();
        const target = leads.find(l => l.id === params.leadId);
        if (!target) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Lead not found.' }));
          return;
        }

        addLog(`✉️ Sending personalized cold email with resume to ${target.targetEmail} (${target.company})...`);
        try {
          await sendColdEmailToRecruiter(target);
          addLog(`✅ Email delivered to ${target.targetEmail}!`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, message: `Email delivered to ${target.targetEmail}` }));
        } catch (e) {
          addLog(`❌ Failed to email ${target.targetEmail}: ${e.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // API: Deep Upgrade Generic Leads to Real TA & Hiring Managers
    if (req.method === 'POST' && url.pathname === '/api/leads/upgrade') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Deep Upgrade initiated in background.' }));

      (async () => {
        try {
          addLog('🚀 [Deep Upgrade] Starting conversion of generic company leads to specific TA & Hiring Managers...');
          const { deepUpgradeGenericLeads } = await import('../scrapers/recruiterFinder.js');
          const result = await deepUpgradeGenericLeads({
            onLog: (msg) => addLog(msg),
            maxCompanies: 20
          });
          addLog(`🎉 [Deep Upgrade Finished] Created ${result.upgraded} real verified recruiter & hiring manager leads!`);
        } catch (e) {
          addLog(`❌ [Deep Upgrade Failed]: ${e.message}`);
        }
      })();
      return;
    }

    // API: Apply to Lead Job URL (Auto-Fill & Submit)
    if (req.method === 'POST' && url.pathname === '/api/leads/apply') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        let params = {};
        try { params = JSON.parse(body); } catch {}

        const { applyToJobUrl } = await import('../automation/jobUrlApplier.js');
        const { updateLeadApplyStatus, getSavedLeads } = await import('../scrapers/recruiterFinder.js');

        if (params.batch) {
          const max = params.max || 5;
          const leads = getSavedLeads().filter(l => l.jobUrl && l.applyStatus !== 'APPLIED').slice(0, max);
          addLog(`⚡ [Batch Lead Apply] Initiating auto-apply across ${leads.length} leads...`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, message: `Auto-apply started for ${leads.length} leads.` }));

          (async () => {
            let successCount = 0;
            for (const lead of leads) {
              addLog(`⚡ Auto-applying to "${lead.title}" @ ${lead.company}...`);
              try {
                const result = await applyToJobUrl(lead.jobUrl, {
                  companyName: lead.company,
                  jobTitle: lead.title,
                  headless: true,
                  onLog: (msg) => addLog(msg)
                });
                if (result.success) {
                  updateLeadApplyStatus(lead.id, 'APPLIED');
                  addLog(`✅ Successfully applied to ${lead.company}! (${result.status})`);
                  successCount++;
                } else {
                  addLog(`⚠️ Auto-apply info for ${lead.company}: ${result.error || result.status}`);
                }
              } catch (err) {
                addLog(`❌ Apply error for ${lead.company}: ${err.message}`);
              }
              const { randomSleep } = await import('../automation/browser.js');
              await randomSleep(4000, 7000);
            }
            addLog(`🎉 [Batch Complete] Finished applying to leads (${successCount} submitted).`);
          })();
          return;
        }

        const leads = getSavedLeads();
        const { parseJobDetailsFromUrl } = await import('../automation/jobUrlApplier.js');
        const autoParsed = parseJobDetailsFromUrl(params.jobUrl || '');
        const target = leads.find(l => l.id === params.leadId) || { 
          jobUrl: params.jobUrl, 
          company: params.company || autoParsed.company || 'Company', 
          title: params.title || autoParsed.title || 'Engineering Role' 
        };

        if (!target || !target.jobUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Job URL required.' }));
          return;
        }

        addLog(`⚡ [Lead Apply] Auto-applying to "${target.title}" @ ${target.company}...`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: 'Auto-apply initiated.' }));

        (async () => {
          try {
            const result = await applyToJobUrl(target.jobUrl, {
              companyName: target.company,
              jobTitle: target.title,
              headless: params.visible ? false : true,
              standalone: true,
              onLog: (msg) => addLog(msg)
            });
            if (result.success) {
              if (params.leadId) updateLeadApplyStatus(params.leadId, 'APPLIED');
              addLog(`🎉 Applied to ${target.company}! Status: ${result.status} (${result.message || ''})`);
            } else {
              addLog(`⚠️ Auto-apply info for ${target.company}: ${result.error || result.status}`);
            }
          } catch (e) {
            addLog(`❌ Apply error: ${e.message}`);
          }
        })();
      });
      return;
    }

    // API: Follow-Ups List
    if (req.method === 'GET' && url.pathname === '/api/leads/follow-ups') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        eligible: getEligibleFollowUps(2),
        history: getFollowUpHistory()
      }));
      return;
    }

    // API: Trigger Follow-Ups
    if (req.method === 'POST' && url.pathname === '/api/leads/follow-up') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        let params = {};
        try { params = JSON.parse(body); } catch {}

        if (state.isSendingFollowUps) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Follow-up campaign is already actively running.' }));
          return;
        }

        const max = params.max || 5;
        const days = params.days !== undefined ? params.days : 2;

        state.isSendingFollowUps = true;
        addLog(`📬 [Follow-Up Engine] Dispatched follow-ups (Max: ${max}, Sent >= ${days} days ago)...`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: 'Follow-up campaign started.' }));

        (async () => {
          try {
            const sent = await sendBatchFollowUps({ maxCount: max, minDays: days, force: params.force || false });
            addLog(`🎉 [Follow-Up Engine] Successfully delivered ${sent.length} threaded follow-ups!`);
          } catch (e) {
            addLog(`❌ [Follow-Up Engine Error]: ${e.message}`);
          } finally {
            state.isSendingFollowUps = false;
          }
        })();
      });
      return;
    }

    // API: Run Naukri 1-Click Auto-Apply (0-5 YOE, Maximum Fresh Jobs)
    if (req.method === 'POST' && url.pathname === '/api/naukri/apply') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        let params = {};
        try { params = JSON.parse(body); } catch {}
        const maxApps = params.maxApplications || 20;
        const dailyMax = !!params.dailyMax;
        const allowCareerSites = params.allowCareerSites !== undefined ? params.allowCareerSites : true;
        const minExp = params.minExp !== undefined ? params.minExp : 0;
        const maxExp = params.maxExp !== undefined ? params.maxExp : 5;

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          message: dailyMax
            ? 'Naukri Daily Max Apply sweep started (Target: up to 50 jobs / daily limit).'
            : `Naukri auto-apply started (0-5 YOE, target: ${maxApps} jobs).`
        }));

        (async () => {
          try {
            addLog(`🚀 [Naukri Apply] Initiating ${dailyMax ? 'DAILY MAX' : 'sweep'} for fresh 0-5 YOE Data Engineer roles (Target: ${dailyMax ? '50 (or daily quota limit)' : maxApps} jobs, Career Sites: ${allowCareerSites ? 'YES' : 'NO'})...`);
            const { applyToNaukriJobs } = await import('../automation/naukriApplier.js');
            const res = await applyToNaukriJobs({
              maxApplications: maxApps,
              dailyMax,
              allowCareerSites,
              minExp,
              maxExp,
              headless: true
            });
            addLog(`🎉 [Naukri Apply Complete] Successfully submitted ${res.appliedCount} new applications on Naukri & Career Sites!`);
          } catch (e) {
            addLog(`❌ [Naukri Apply Error]: ${e.message}`);
          }
        })();
      });
      return;
    }

    // API: Run LinkedIn Easy Apply
    if (req.method === 'POST' && url.pathname === '/api/linkedin/apply') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'LinkedIn Easy Apply started.' }));
      (async () => {
        try {
          addLog('🚀 [LinkedIn Apply] Initiating LinkedIn Easy Apply sweep (2-5 YOE Data Engineer)...');
          const { applyToLinkedInJobs } = await import('../automation/linkedinApplier.js');
          const res = await applyToLinkedInJobs({ maxApplications: 5, headless: true });
          if (res.needsLogin) {
            addLog('⚠️ [LinkedIn Notice] LinkedIn login session required. Run login_linkedin.bat once to log in.');
          } else {
            addLog(`🎉 [LinkedIn Apply Complete] Successfully submitted ${res.appliedCount} new applications on LinkedIn!`);
          }
        } catch (e) {
          addLog(`❌ [LinkedIn Apply Error]: ${e.message}`);
        }
      })();
      return;
    }

    // API: Run Glassdoor Harvest
    if (req.method === 'POST' && url.pathname === '/api/glassdoor/harvest') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Glassdoor harvest started.' }));
      (async () => {
        try {
          addLog('🔍 [Glassdoor Harvest] Scraping fresh Data Engineer postings and resolving ATS portals...');
          const { searchGlassdoorJobs } = await import('../scrapers/glassdoorScraper.js');
          const res = await searchGlassdoorJobs({ query: 'Data Engineer', location: 'India', maxResults: 15, headless: true });
          addLog(`🎉 [Glassdoor Complete] Discovered ${res.length} live postings from Glassdoor India!`);
        } catch (e) {
          addLog(`❌ [Glassdoor Harvest Error]: ${e.message}`);
        }
      })();
      return;
    }


    // API: Run Naukri Ranker
    if (req.method === 'POST' && url.pathname === '/api/naukri/rank') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        let params = {};
        try { params = JSON.parse(body); } catch {}

        if (state.isRankingNaukri) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Naukri ranker is already actively running.' }));
          return;
        }

        state.isRankingNaukri = true;
        const headless = params.headless !== undefined ? params.headless : true;
        addLog(`🚀 [Naukri Ranker] Starting profile boost (${headless ? 'Headless' : 'Visible browser'})...`);

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: 'Naukri profile boost started.' }));

        (async () => {
          try {
            const res = await runNaukriDailyRanker({ headless, action: params.action || 'all' });
            if (res.status === 'AUTH_REQUIRED' || res.status === 'AUTH_FAILED') {
              addLog(`⚠️ [Naukri Ranker] ${res.message}`);
            } else {
              addLog(`🎉 [Naukri Ranker] Boost finished: ${res.status} (${res.actionsCompleted?.join(', ') || 'No changes'})`);
            }
          } catch (e) {
            addLog(`❌ [Naukri Ranker Error]: ${e.message}`);
          } finally {
            state.isRankingNaukri = false;
          }
        })();
      });
      return;
    }

    // API: Naukri Status & Logs
    if (req.method === 'GET' && url.pathname === '/api/naukri/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        isRanking: state.isRankingNaukri,
        isSessionSaved: isNaukriSessionSaved(),
        hasPassword: !!process.env.NAUKRI_PASSWORD,
        logs: getNaukriRankLogs()
      }));
      return;
    }

    // API: Open Naukri Profile in Chrome Browser
    if (req.method === 'POST' && url.pathname === '/api/naukri/open') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Opening Naukri login window on your screen...' }));
      (async () => {
        try {
          addLog('🌐 Launching Naukri Login / Profile Window on your screen...');
          await launchNaukriLoginWindow();
          addLog('🎉 Naukri session successfully saved to disk!');
        } catch (e) {
          addLog(`❌ Naukri window: ${e.message}`);
        }
      })();
      return;
    }

    // API: List Available Resumes
    if (req.method === 'GET' && url.pathname === '/api/resumes') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      const prof = loadProfile();
      const currentPath = prof.documents?.resumePath || '';
      const currentFilename = path.basename(currentPath);
      const dataDir = path.resolve(__dirname, '../../data');

      let pdfFiles = [];
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf')).map(f => {
          try {
            const stats = fs.statSync(path.join(dataDir, f));
            return {
              filename: f,
              size: (stats.size / 1024).toFixed(1) + ' KB',
              modifiedAt: stats.mtime.toISOString(),
              isActive: f === currentFilename
            };
          } catch {
            return { filename: f, size: 'Unknown', isActive: f === currentFilename };
          }
        });
      }

      res.end(JSON.stringify({
        currentResume: currentFilename,
        currentResumePath: currentPath,
        resumes: pdfFiles
      }));
      return;
    }

    // API: Upload New PDF Resume
    if (req.method === 'POST' && url.pathname === '/api/resumes/upload') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { filename, base64 } = JSON.parse(body);
          if (!filename || !base64) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Filename and base64 data required.' }));
            return;
          }

          const cleanName = path.basename(filename).replace(/[^a-zA-Z0-9.\-_]/g, '_');
          if (!cleanName.toLowerCase().endsWith('.pdf')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Only PDF resume files are supported.' }));
            return;
          }

          const dataDir = path.resolve(__dirname, '../../data');
          if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

          const targetPath = path.join(dataDir, cleanName);
          const buffer = Buffer.from(base64, 'base64');
          fs.writeFileSync(targetPath, buffer);

          // Update profile.json
          const profilePath = path.resolve(__dirname, '../../config/profile.json');
          const prof = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
          if (!prof.documents) prof.documents = {};
          prof.documents.resumePath = `data/${cleanName}`;
          fs.writeFileSync(profilePath, JSON.stringify(prof, null, 2), 'utf-8');

          addLog(`📄 [Resume Manager] Uploaded & activated new resume: "${cleanName}" (${(buffer.length / 1024).toFixed(1)} KB)`);

          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: true,
            filename: cleanName,
            size: (buffer.length / 1024).toFixed(1) + ' KB',
            message: `Resume "${cleanName}" uploaded and set as active for all applications & emails!`
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // API: Select Active Resume
    if (req.method === 'POST' && url.pathname === '/api/resumes/select') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { filename } = JSON.parse(body);
          const dataDir = path.resolve(__dirname, '../../data');
          const cleanName = path.basename(filename);
          const targetPath = path.join(dataDir, cleanName);

          if (!fs.existsSync(targetPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Resume file "${cleanName}" not found.` }));
            return;
          }

          // Update profile.json
          const profilePath = path.resolve(__dirname, '../../config/profile.json');
          const prof = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
          if (!prof.documents) prof.documents = {};
          prof.documents.resumePath = `data/${cleanName}`;
          fs.writeFileSync(profilePath, JSON.stringify(prof, null, 2), 'utf-8');

          addLog(`📄 [Resume Manager] Switched active resume to: "${cleanName}"`);

          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: true,
            filename: cleanName,
            message: `Active resume switched to "${cleanName}"!`
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // API: Delete Resume PDF
    if (req.method === 'POST' && url.pathname === '/api/resumes/delete') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { filename } = JSON.parse(body);
          if (!filename) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Filename is required.' }));
            return;
          }

          const cleanName = path.basename(filename);
          const dataDir = path.resolve(__dirname, '../../data');
          const targetPath = path.join(dataDir, cleanName);

          if (!fs.existsSync(targetPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Resume file "${cleanName}" does not exist.` }));
            return;
          }

          const allPdfs = fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.pdf'));
          if (allPdfs.length <= 1) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cannot delete the only available resume. Please upload a replacement PDF first.' }));
            return;
          }

          fs.unlinkSync(targetPath);

          // If the deleted resume was currently active, update profile.json to point to another remaining PDF
          const profilePath = path.resolve(__dirname, '../../config/profile.json');
          const prof = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
          let activeName = path.basename(prof.documents?.resumePath || '');
          let newActive = activeName;

          if (activeName === cleanName) {
            const remaining = fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.pdf'));
            newActive = remaining[0] || '';
            if (!prof.documents) prof.documents = {};
            prof.documents.resumePath = newActive ? `data/${newActive}` : '';
            fs.writeFileSync(profilePath, JSON.stringify(prof, null, 2), 'utf-8');
          }

          addLog(`🗑️ [Resume Manager] Deleted resume "${cleanName}". Active resume: "${newActive}"`);

          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: true,
            deleted: cleanName,
            activeResume: newActive,
            message: `Resume "${cleanName}" deleted successfully.`
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // API: 30-Minute Auto-Pilot Status
    if (req.method === 'GET' && url.pathname === '/api/autopilot/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(getAutoPilotStatus()));
      return;
    }

    // API: Toggle 30-Minute Auto-Pilot
    if (req.method === 'POST' && url.pathname === '/api/autopilot/toggle') {
      const current = getAutoPilotStatus();
      if (current.isActive) {
        const result = stop30MinAutoPilot();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ...result, ...getAutoPilotStatus() }));
      } else {
        const result = start30MinAutoPilot(true);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ...result, ...getAutoPilotStatus() }));
      }
      return;
    }

    // API: Get Full Settings (Credentials + Screening Q&A)
    if (req.method === 'GET' && url.pathname === '/api/settings') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(getFullSettings()));
      return;
    }

    // API: Save Full Settings (Credentials + Screening Q&A)
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body);
          const result = saveFullSettings(payload);
          addLog('⚙️ [Settings] Updated account credentials & screening Q&A settings!');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // API: Launch LinkedIn Login Window
    if (req.method === 'POST' && url.pathname === '/api/linkedin/open') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Opening LinkedIn login window on your screen...' }));
      (async () => {
        try {
          addLog('🌐 Launching LinkedIn Login Window on your screen...');
          const { default: cp } = await import('child_process');
          const batPath = path.resolve(__dirname, '../../login_linkedin.bat');
          cp.spawn('cmd.exe', ['/c', 'start', '""', batPath], {
            detached: true,
            stdio: 'ignore'
          }).unref();
        } catch (e) {
          addLog(`❌ LinkedIn window error: ${e.message}`);
        }
      })();
      return;
    }

    // API: Save LinkedIn Session Cookie directly
    if (req.method === 'POST' && url.pathname === '/api/linkedin/save-cookie') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { cookie } = JSON.parse(body);
          if (!cookie || cookie.length < 15) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid cookie value.' }));
            return;
          }
          const cleanCookie = cookie.trim().replace(/^li_at=/, '').replace(/;.*$/, '');
          const storageState = {
            cookies: [
              {
                name: 'li_at',
                value: cleanCookie,
                domain: '.linkedin.com',
                path: '/',
                expires: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
                httpOnly: true,
                secure: true,
                sameSite: 'None'
              }
            ],
            origins: []
          };
          const targetPath = path.resolve(__dirname, '../../data/linkedin_storage_state.json');
          fs.writeFileSync(targetPath, JSON.stringify(storageState, null, 2), 'utf8');
          addLog('✅ LinkedIn session cookie saved directly! Bot is now authenticated.');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // API: Start Batch Apply
    if (req.method === 'POST' && url.pathname === '/api/start') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        let params = {};
        try { params = JSON.parse(body); } catch {}

        const max = params.max || 50;
        const batchType = params.batchType || 'custom';
        const maxAgeHours = params.maxAgeHours !== undefined ? params.maxAgeHours : 48;


        if (state.isRunning) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'A batch is already actively running.' }));
          return;
        }

        state.isRunning = true;
        state.shouldStop = false;
        state.batchType = batchType;
        state.currentProgress = 0;
        state.totalTarget = max;
        state.currentJob = null;
        state.statusText = `Starting ${batchType.toUpperCase()} Batch (${max} jobs, prioritizing < ${maxAgeHours}hr)...`;
        addLog(`🚀 [UI Trigger] Initiated ${batchType.toUpperCase()} batch for ${max} positions.`);

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: `Batch ${batchType} started.` }));

        // Run batch asynchronously in background
        (async () => {
          try {
            const report = await runDailyJobHuntAndApply({
              dailyMax: max,
              maxAgeHours,
              headless: true,
              sendEmail: true,
              dryRun: false,
              shouldStop: () => state.shouldStop,
              onProgress: (prog) => {
                state.currentProgress = prog.index;
                state.totalTarget = prog.total;
                state.currentJob = prog.job;
                state.statusText = prog.message;
                addLog(prog.message);
              }
            });

            if (report && report.halted) {
              state.statusText = `Batch paused at Job ${state.currentProgress}/${max}: Strict email verification gate halted run to protect integrity.`;
              addLog(`🛑 [Strict Confirmation Gate] Batch paused at Job ${state.currentProgress}/${max} because verified employer receipt email was missing.`);
            } else {
              const count = report ? report.appliedCount : 0;
              state.statusText = `Completed! Successfully submitted & verified ${count} jobs in ${batchType} batch.`;
              addLog(`🎉 Finished ${batchType} batch run (${count} verified submissions).`);
            }
          } catch (e) {
            state.statusText = `Error: ${e.message}`;
            addLog(`❌ Batch error: ${e.message}`);
          } finally {
            state.isRunning = false;
            state.currentJob = null;
          }
        })();
      });
      return;
    }

    // API: Stop
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      state.shouldStop = true;
      state.statusText = 'Stop requested. Finishing current step...';
      addLog('🛑 Stop requested by user via dashboard.');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Stop signal dispatched.' }));
      return;
    }

    // Serve HTML Dashboard
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHtml());
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`\n============================================================`);
    console.log(`🖥️ JOB BOT WEB CONTROL DASHBOARD ONLINE`);
    console.log(`🔗 Open in your browser: http://localhost:${port}`);
    console.log(`============================================================\n`);
  });

  return server;
}

function getDashboardHtml() {
  let candidateName = 'Prakash Kumar Yadav';
  let candidateRole = 'Data Engineer';
  let resumeName = 'Prakash-Kumar-Yadav-Resume.pdf';
  let noticeTerms = '15 Days Notice (Negotiable)';
  let seoHeadline = 'Data Engineer | 2.8+ Yrs | Python, PySpark, SQL, Airflow | 15 Days Notice';
  try {
    const prof = loadProfile();
    const first = prof.personal?.firstName || '';
    const last = prof.personal?.lastName || '';
    candidateName = `${first} ${last}`.trim() || candidateName;
    candidateRole = prof.experience?.currentTitle || prof.workPreferences?.targetRoles?.[0] || candidateRole;
    if (prof.documents?.resumePath) resumeName = path.basename(prof.documents.resumePath);
    noticeTerms = `${prof.workPreferences?.effectiveNoticePeriodDays || 15} Days (Negotiable)`;
    const skillsList = prof.customAnswers?.primarySkills
      ? prof.customAnswers.primarySkills.split(',').slice(0, 5).map(s => s.trim()).join(', ')
      : 'Python, PySpark, SQL';
    seoHeadline = `${candidateRole} | ${prof.experience?.totalYears || '2.8+'} Yrs | ${skillsList} | ${noticeTerms}`;
  } catch {}

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity Job Bot — Auto-Pilot & Recruiter Outreach</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @keyframes pulse-slow { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    .pulse-live { animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen font-sans">
  <div class="max-w-6xl mx-auto px-4 py-8">
    
    <!-- Top Header -->
    <header class="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-800 gap-4">
      <div>
        <div class="flex items-center gap-3">
          <span class="text-3xl">🤖</span>
          <h1 class="text-2xl font-bold tracking-tight text-white">Autonomous Job Auto-Pilot</h1>
          <span id="badge-status" class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Engine Ready
          </span>
        </div>
        <p class="text-sm text-slate-400 mt-1">
          Candidate: <strong>${candidateName}</strong> · ${candidateRole} · Direct ATS + Recruiter Cold Outreach (Zero Ban Risk)
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <!-- LinkedIn Session Status & 1-Click Login -->
        <button onclick="openLinkedInBrowser()" id="btn-linkedin-header" class="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-[#0A66C2]/20 border border-[#0A66C2]/40 text-[#38bdf8] hover:bg-[#0A66C2]/35 active:scale-[0.98] transition flex items-center gap-2 shadow" title="Click to log in to LinkedIn for deep Talent Acquisition and Hiring Manager discovery">
          <span>🔑</span>
          <span id="linkedin-header-label">Connect LinkedIn</span>
        </button>

        <!-- Settings Button -->
        <button onclick="openSettingsModal()" class="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-900 border border-slate-700 text-slate-200 hover:text-white hover:border-slate-500 hover:bg-slate-800 active:scale-[0.98] transition flex items-center gap-2 shadow">
          <span>⚙️</span>
          <span>Credentials & Settings</span>
        </button>

        <div class="flex items-center gap-5 bg-slate-900 border border-slate-800 rounded-xl px-5 py-3">
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-medium">Lifetime Applied</div>
            <div id="stat-total" class="text-2xl font-black text-emerald-400">0</div>
          </div>
          <div class="h-8 w-px bg-slate-800"></div>
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-medium">Recruiter Leads</div>
            <div id="stat-leads" class="text-2xl font-black text-amber-400">0</div>
          </div>
          <div class="h-8 w-px bg-slate-800"></div>
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-medium">Follow-Ups Due</div>
            <div id="stat-followups" class="text-2xl font-black text-sky-400">0</div>
          </div>
          <div class="h-8 w-px bg-slate-800"></div>
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-medium">Naukri Rank</div>
            <div id="stat-naukri" class="text-xs font-semibold text-emerald-400 mt-1">Ready</div>
          </div>
        </div>
      </div>
    </header>

    <!-- Active Resume Manager Card -->
    <div class="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-sky-950/60 border border-emerald-500/40 rounded-2xl p-6 mb-8 hover:border-emerald-500/70 transition shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div>
          <div class="flex items-center gap-2.5 mb-2">
            <span class="text-3xl">📄</span>
            <h3 class="text-xl font-black text-white tracking-tight">Active Resume Manager</h3>
            <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Synced Across All Applications
            </span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed max-w-2xl">
            Upload or switch your target PDF resume here. This <strong>exact file</strong> is attached to all <strong class="text-amber-300">Recruiter Cold Emails</strong>, submitted in <strong class="text-emerald-300">Naukri 1-Click Apply</strong>, uploaded during <strong class="text-purple-300">Naukri SEO Profile Boost</strong>, and submitted in <strong class="text-blue-300">LinkedIn & ATS portals</strong>.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- Active Resume Status Badge -->
          <div class="px-4 py-2.5 rounded-xl bg-slate-950 border border-emerald-500/30 flex items-center gap-3">
            <span class="w-3 h-3 rounded-full bg-emerald-400 animate-ping"></span>
            <div>
              <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Active File</div>
              <div id="active-resume-display" class="font-mono text-emerald-300 font-bold text-xs truncate max-w-[200px]">${resumeName}</div>
            </div>
          </div>

          <!-- Upload New PDF Button -->
          <label class="cursor-pointer py-2.5 px-4 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition shadow-md flex items-center gap-2 text-xs">
            <span>📤 Upload / Change PDF</span>
            <input type="file" id="resume-file-input" accept=".pdf" class="hidden" onchange="handleResumeUpload(event)">
          </label>

          <!-- Dropdown of Available Resumes & Delete Button -->
          <div class="flex items-center gap-2">
            <select id="resume-select-dropdown" onchange="handleResumeSelect(this.value)" class="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none cursor-pointer">
              <option value="${resumeName}">Active: ${resumeName}</option>
            </select>
            <button onclick="handleResumeDelete()" title="Delete selected resume from storage" class="py-2.5 px-3 rounded-xl font-bold text-rose-300 bg-rose-950/60 border border-rose-500/40 hover:bg-rose-900/60 active:scale-[0.98] transition flex items-center gap-1.5 text-xs shadow">
              <span>🗑️ Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 30-Minute Continuous Auto-Pilot Card -->
    <div class="bg-gradient-to-r from-blue-950/60 via-slate-900 to-indigo-950/60 border border-blue-500/40 rounded-2xl p-6 mb-8 hover:border-blue-500/70 transition shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div>
          <div class="flex items-center gap-2.5 mb-2">
            <span class="text-3xl">⏱️</span>
            <h3 class="text-xl font-black text-white tracking-tight">30-Minute Autonomous Auto-Pilot</h3>
            <span id="ap-badge" class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              Stopped
            </span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed max-w-2xl">
            Runs continuously in the background every <strong>30 minutes</strong>: touches & boosts your Naukri profile timestamp to keep you at <strong>#1 in recruiter searches ("Active Just Now")</strong>, applies to <strong>fresh 0-5 YOE Data Engineer jobs</strong> with human pacing (6-12s delays), and dispatches fresh recruiter cold emails.
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400">
            <div>Cycles Completed: <strong id="ap-cycles" class="text-emerald-400">0</strong></div>
            <div>•</div>
            <div>Next Run: <strong id="ap-countdown" class="text-sky-300">Inactive</strong></div>
            <div>•</div>
            <div id="ap-last-summary" class="text-slate-400 truncate max-w-md">Ready to start.</div>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <button id="btn-autopilot-toggle" onclick="toggleAutoPilot()" class="py-3 px-6 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition shadow-lg flex items-center gap-2 text-xs">
            <span id="ap-btn-icon">▶️</span>
            <span id="ap-btn-text">Start 30-Min Auto-Pilot</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Main Control Buttons Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 my-8">
      
      <!-- Morning Batch Button -->
      <div class="bg-gradient-to-b from-amber-500/10 to-slate-900 border border-amber-500/30 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/60 transition shadow-lg">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-3xl">🌅</span>
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Morning Batch</span>
          </div>
          <h3 class="text-xl font-bold text-white">Start Morning Run</h3>
          <p class="text-sm text-slate-400 mt-2">
            Auto-applies across Naukri (1-click), LinkedIn (Easy Apply), Glassdoor & ATS company boards (Greenhouse, Lever, Ashby) for 2–5 YOE Data Engineer roles (submits up to <strong>50 roles</strong>).
          </p>
        </div>
        <button id="btn-morning" onclick="startBatch('morning', 50, 48)" class="mt-6 w-full py-3 px-4 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2">
          <span>🌅 Start Morning Batch (50 Jobs)</span>
        </button>
      </div>

      <!-- Evening Batch Button -->
      <div class="bg-gradient-to-b from-indigo-500/10 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 flex flex-col justify-between hover:border-indigo-500/60 transition shadow-lg">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-3xl">🌙</span>
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Evening Batch</span>
          </div>
          <h3 class="text-xl font-bold text-white">Start Evening Run</h3>
          <p class="text-sm text-slate-400 mt-2">
            Captures all end-of-day tech openings across India hubs on Naukri, LinkedIn, Glassdoor & ATS portals and submits up to <strong>50 roles</strong>.
          </p>
        </div>
        <button id="btn-evening" onclick="startBatch('evening', 50, 48)" class="mt-6 w-full py-3 px-4 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2">
          <span>🌙 Start Evening Batch (50 Jobs)</span>
        </button>
      </div>

      <!-- Turbo 100 Batch Button -->
      <div class="bg-gradient-to-b from-emerald-500/10 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 flex flex-col justify-between hover:border-emerald-500/60 transition shadow-lg">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-3xl">⚡</span>
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Mass Auto-Pilot</span>
          </div>
          <h3 class="text-xl font-bold text-white">100-Job Mass Apply</h3>
          <p class="text-sm text-slate-400 mt-2">
            Executes maximum throughput across Naukri, LinkedIn, Glassdoor & verified employers, submitting up to <strong>100 positions</strong>.
          </p>
        </div>
        <button id="btn-turbo" onclick="startBatch('turbo', 100, 72)" class="mt-6 w-full py-3 px-4 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2">
          <span>⚡ Apply to 100 Jobs</span>
        </button>
      </div>

    </div>


    <!-- Power Multipliers: Naukri Top-Ranker & Follow-Up Engine -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      
      <!-- Naukri.com Daily Top-Ranker -->
      <div class="bg-gradient-to-b from-purple-500/10 to-slate-900 border border-purple-500/30 rounded-2xl p-6 flex flex-col justify-between hover:border-purple-500/60 transition shadow-lg">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-3xl">🚀</span>
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">Naukri Resdex #1</span>
          </div>
          <h3 class="text-xl font-bold text-white">Naukri Daily Profile Top-Ranker</h3>
          <p class="text-sm text-slate-400 mt-2">
            Automatically refreshes Resume Headline (SEO optimized) & touches profile timestamps to give you the <strong>"Active Today"</strong> badge. Pushes ${candidateName.split(' ')[0]} to Page 1 of recruiter searches!
          </p>

          <div class="mt-4 p-3.5 rounded-xl bg-purple-950/40 border border-purple-500/20 text-xs space-y-2">
            <div class="flex justify-between items-center text-slate-300">
              <span>👤 Candidate Profile:</span>
              <strong class="text-white">${candidateName}</strong>
            </div>
            <div class="flex justify-between items-center text-slate-300">
              <span>⏱️ Notice Period:</span>
              <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold text-[11px]">${noticeTerms}</span>
            </div>
            <div class="flex justify-between items-center text-slate-300">
              <span>📄 Resume Attached:</span>
              <span class="text-sky-300 font-mono">${resumeName}</span>
            </div>
            <div class="text-slate-400 pt-1 text-[11px] leading-relaxed border-t border-purple-500/10">
              <span class="text-purple-300 font-semibold">SEO Headline:</span> ${seoHeadline}
            </div>
          </div>

          <!-- Auth Status Indicators (Naukri & LinkedIn) -->
          <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div id="naukri-auth-box" class="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span id="naukri-dot" class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                <span id="naukri-auth-text" class="text-slate-300">Checking Naukri auth...</span>
              </div>
              <span id="naukri-action-tip" class="text-slate-400 text-[11px]"></span>
            </div>
            <div id="linkedin-auth-box" class="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span id="linkedin-dot" class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                <span id="linkedin-auth-text" class="text-slate-300">Checking LinkedIn auth...</span>
              </div>
              <button onclick="openLinkedInBrowser()" class="px-2.5 py-1 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 text-[11px] font-bold border border-blue-500/30">Login Now</button>
            </div>
          </div>
        </div>
        <div class="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <button id="btn-naukri-apply" onclick="applyNaukri(false)" class="py-3 px-3 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 text-xs" title="Apply to up to 20 fresh jobs">
            <span>⚡ Apply (20 Jobs)</span>
          </button>
          <button id="btn-naukri-daily-max" onclick="applyNaukri(true)" class="py-3 px-3 rounded-xl font-bold text-white bg-emerald-700 hover:bg-emerald-600 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 text-xs" title="Apply daily maximum until quota is reached (~50 jobs)">
            <span>🔥 Daily Max (50 Jobs)</span>
          </button>
          <button id="btn-linkedin-login" onclick="openLinkedInBrowser()" class="py-3 px-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 text-xs" title="Open Chrome window to log in manually and save session for bot">
            <span>🔑 Login LinkedIn</span>
          </button>
          <button id="btn-glassdoor" onclick="harvestGlassdoor()" class="py-3 px-3 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 text-xs">
            <span>🔍 Glassdoor Jobs</span>
          </button>
          <button id="btn-naukri-rank" onclick="runNaukriBoost('all', true)" class="py-3 px-3 rounded-xl font-bold text-white bg-purple-600 hover:bg-purple-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-1.5 text-xs">
            <span>🚀 Boost Profile</span>
          </button>
        </div>

      </div>

      <!-- Follow-Up Engine Card -->
      <div class="bg-gradient-to-b from-sky-500/10 to-slate-900 border border-sky-500/30 rounded-2xl p-6 flex flex-col justify-between hover:border-sky-500/60 transition shadow-lg">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-3xl">📬</span>
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">30-Day Notice Nudge</span>
          </div>
          <h3 class="text-xl font-bold text-white">Automated Recruiter Follow-Up Engine</h3>
          <p class="text-sm text-slate-400 mt-2">
            Scans outreach sent $\ge 2$ days ago without reply. Dispatches polite, threaded follow-ups directly replying to the original email with resume attached & 30-day notice highlighted.
          </p>
        </div>
        <div class="mt-6 flex items-center gap-3">
          <button id="btn-followup" onclick="sendFollowUps(5)" class="flex-1 py-3 px-4 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-500 active:scale-[0.98] transition shadow-md flex items-center justify-center gap-2">
            <span>📬 Send Due Follow-Ups (5 Max)</span>
          </button>
        </div>
      </div>

    </div>

    <!-- 🎯 Manual Job Link Auto-Applier Card -->
    <div class="bg-gradient-to-r from-blue-950/70 via-slate-900 to-indigo-950/70 border border-blue-500/40 rounded-2xl p-6 mb-8 hover:border-blue-500/70 transition shadow-xl">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="text-2xl">🎯</span>
            <h3 class="text-lg font-black text-white tracking-tight">Manual Job Link Auto-Applier</h3>
            <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Universal ATS & Portal Support
            </span>
          </div>
          <p class="text-xs text-slate-300 mt-1">
            Paste any job URL from <strong>LinkedIn, Naukri, Greenhouse, Lever, Workday, Ashby, Indeed</strong>, or any employer career page. The bot will open the link, prefill your profile details, attach your active resume (<span class="font-mono text-emerald-300">${resumeName}</span>), and submit automatically!
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs text-slate-300 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 self-start md:self-auto">
          <input type="checkbox" id="custom-visible-browser" class="rounded border-slate-700 text-blue-600 focus:ring-0 cursor-pointer">
          <label for="custom-visible-browser" class="cursor-pointer select-none">👁️ Show Live Browser Window</label>
        </div>
      </div>

      <div class="flex flex-col lg:flex-row gap-3">
        <input 
          type="url" 
          id="custom-job-url" 
          placeholder="Paste Job URL here (e.g. https://jobs.lever.co/... or https://www.linkedin.com/jobs/view/...)" 
          class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-inner"
        >
        <div class="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <input 
            type="text" 
            id="custom-company-name" 
            placeholder="Company (optional)" 
            class="w-full sm:w-36 bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          >
          <input 
            type="text" 
            id="custom-job-title" 
            placeholder="Job Title (optional)" 
            class="w-full sm:w-36 bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          >
          <button 
            id="btn-apply-custom-url" 
            onclick="applyCustomUrl()" 
            class="w-full sm:w-auto py-3 px-6 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition shadow-lg flex items-center justify-center gap-2 text-xs whitespace-nowrap"
          >
            <span>⚡ Apply Now</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Active Run Status Box -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div id="status-indicator" class="w-3.5 h-3.5 rounded-full bg-slate-600"></div>
          <h3 class="text-lg font-bold text-white" id="status-title">Engine Status: Idle</h3>
        </div>
        <button id="btn-stop" onclick="stopBatch()" class="hidden px-4 py-1.5 rounded-lg font-semibold text-xs bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 transition">
          🛑 Stop Active Run
        </button>
      </div>

      <!-- Progress Bar -->
      <div class="w-full bg-slate-800 rounded-full h-3 mb-4 overflow-hidden">
        <div id="progress-bar" class="bg-emerald-500 h-3 rounded-full transition-all duration-500" style="width: 0%"></div>
      </div>
      <div class="flex justify-between text-xs text-slate-400 font-mono">
        <span id="progress-label">0 / 0 Completed</span>
        <span id="progress-percent">0%</span>
      </div>

      <!-- Current Job In-Flight -->
      <div id="current-job-card" class="hidden mt-4 p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-sm">
        <div class="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">Currently Processing</div>
        <div class="font-bold text-white text-base" id="cj-title">Staff Backend Engineer</div>
        <div class="text-slate-400 flex items-center gap-3 mt-1 text-xs">
          <span>🏢 <strong id="cj-company" class="text-slate-300">GitLab</strong></span>
          <span>📍 <span id="cj-location">Bangalore, India</span></span>
          <span class="text-emerald-400 font-semibold">🔒 Automatic Gmail OTP Verification Active</span>
        </div>
      </div>
    </div>

    <!-- Recruiter Leads & Cold Outreach Section -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xl">🎯</span>
            <h3 class="text-lg font-bold text-white">Direct Recruiter & Hiring Manager Leads (Multiple Per Job)</h3>
          </div>
          <p class="text-xs text-slate-400 mt-1">
            Discovers verified <strong>Talent Acquisition Specialists (TA)</strong> & <strong>Engineering Hiring Managers</strong> per opening. Send tailored technical cold emails with resume attached in 1 click!
          </p>
          <!-- Lead Stats Breakdown Pills -->
          <div class="flex flex-wrap items-center gap-2 mt-2.5">
            <span id="stat-total-leads" class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300">Total: 0</span>
            <span id="stat-ta-leads" class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">👔 Talent Acquisition: 0</span>
            <span id="stat-hm-leads" class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">🚀 Hiring Managers: 0</span>
            <span id="stat-uncontacted-leads" class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">⏳ Uncontacted: 0</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button onclick="fetchRecruiterLeads()" class="px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition flex items-center gap-1.5 shadow" title="Search fresh LinkedIn & Naukri postings and discover TA + Hiring Managers">
            <span>🔍 Fetch Leads</span>
          </button>
          <button onclick="deepUpgradeLeads()" class="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/40 transition flex items-center gap-1.5 shadow" title="Scan existing generic careers@ leads and replace them with real TA & Hiring Managers">
            <span>🚀 Deep Upgrade</span>
          </button>
          <button onclick="sendBatchOutreach(5, 'TA')" class="px-3 py-2 rounded-xl text-xs font-bold bg-purple-600 text-white hover:bg-purple-500 transition shadow flex items-center gap-1.5" title="Batch email Talent Acquisition specialists">
            <span>👔 Email 5 TA</span>
          </button>
          <button onclick="sendBatchOutreach(5, 'HIRING_MANAGER')" class="px-3 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-500 transition shadow flex items-center gap-1.5" title="Batch email Engineering Managers & Tech Leads">
            <span>🚀 Email 5 Managers</span>
          </button>
          <button onclick="applyBatchLeads(5)" class="px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition shadow flex items-center gap-1.5" title="Auto-apply to the top 5 job links and fill all candidate details">
            <span>⚡ Apply 5</span>
          </button>
          <button onclick="sendFollowUps(5)" class="px-3 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white hover:bg-sky-500 transition shadow flex items-center gap-1.5">
            <span>📬 Follow-Ups</span>
          </button>
        </div>
      </div>

      <!-- Quick Filter Buttons -->
      <div class="flex items-center gap-2 mt-4 mb-2 flex-wrap">
        <span class="text-xs text-slate-400 font-semibold mr-1">Filter Leads:</span>
        <button onclick="setLeadFilter('ALL')" id="filter-all" class="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-white border border-slate-600 shadow">All Contacts</button>
        <button onclick="setLeadFilter('TA')" id="filter-ta" class="px-3 py-1 rounded-lg text-xs font-semibold text-purple-300 hover:bg-purple-500/20 border border-transparent hover:border-purple-500/30">👔 Talent Acquisition</button>
        <button onclick="setLeadFilter('HIRING_MANAGER')" id="filter-hm" class="px-3 py-1 rounded-lg text-xs font-semibold text-amber-300 hover:bg-amber-500/20 border border-transparent hover:border-amber-500/30">🚀 Hiring Managers</button>
        <button onclick="setLeadFilter('UNCONTACTED')" id="filter-uncontacted" class="px-3 py-1 rounded-lg text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 border border-transparent hover:border-emerald-500/30">⏳ Uncontacted</button>
      </div>

      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-left text-xs font-sans table-fixed">
          <thead>
            <tr class="text-slate-400 border-b border-slate-800 pb-2">
              <th class="py-2.5 px-3 w-[15%]">Company</th>
              <th class="py-2.5 px-3 w-[26%]">Role</th>
              <th class="py-2.5 px-3 w-[19%]">Direct Apply Link</th>
              <th class="py-2.5 px-3 w-[19%]">Recruiter & Contact</th>
              <th class="py-2.5 px-3 w-[9%]">Status</th>
              <th class="py-2.5 px-3 text-right w-[12%]">Actions</th>
            </tr>
          </thead>
          <tbody id="leads-table-body" class="divide-y divide-slate-800/60">
            <tr>
              <td colspan="6" class="py-6 text-center text-slate-500">Loading recruiter leads...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Live Terminal Log Stream -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <span>💻</span> Live Execution Feed
        </h4>
        <span class="text-xs text-slate-500 font-mono">Real-time log</span>
      </div>
      <div id="log-terminal" class="bg-black/60 rounded-xl p-4 font-mono text-xs text-slate-300 h-56 overflow-y-auto space-y-1.5 border border-slate-800">
        <div>[System] Dashboard connected to autonomous bot engine. Ready for Morning, Evening, or Recruiter outreach.</div>
      </div>
    </div>

  </div>

  <script>
    let pollInterval = null;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // Update counts
        document.getElementById('stat-total').innerText = data.totalLifetimeApplied;
        document.getElementById('stat-leads').innerText = data.totalLeadsCount || 0;
        if (document.getElementById('stat-followups')) {
          document.getElementById('stat-followups').innerText = data.eligibleFollowUpsCount || 0;
        }

        // Update Recruiter breakdown stats
        if (document.getElementById('stat-total-leads')) {
          document.getElementById('stat-total-leads').innerText = 'Total: ' + (data.totalLeadsCount || 0);
        }
        if (document.getElementById('stat-ta-leads')) {
          document.getElementById('stat-ta-leads').innerText = '👔 Talent Acquisition: ' + (data.taLeadsCount || 0);
        }
        if (document.getElementById('stat-hm-leads')) {
          document.getElementById('stat-hm-leads').innerText = '🚀 Hiring Managers: ' + (data.hmLeadsCount || 0);
        }
        if (document.getElementById('stat-uncontacted-leads')) {
          document.getElementById('stat-uncontacted-leads').innerText = '⏳ Uncontacted: ' + (data.uncontactedLeadsCount || 0);
        }

        // Header LinkedIn status pill
        const linkedinBtnLabel = document.getElementById('linkedin-header-label');
        if (linkedinBtnLabel) {
          if (data.isLinkedInSessionSaved) {
            linkedinBtnLabel.innerText = 'LinkedIn Active';
            const btnEl = document.getElementById('btn-linkedin-header');
            if (btnEl) {
              btnEl.className = 'px-3.5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.98] transition flex items-center gap-2 shadow';
            }
          } else {
            linkedinBtnLabel.innerText = 'Connect LinkedIn';
          }
        }
        if (document.getElementById('stat-naukri')) {
          if (data.isRankingNaukri) {
            document.getElementById('stat-naukri').innerText = 'Boosting...';
          } else if (data.naukriLastRank && data.naukriLastRank.status === 'SUCCESS') {
            document.getElementById('stat-naukri').innerText = 'Active Today';
          } else {
            document.getElementById('stat-naukri').innerText = 'Ready';
          }
        }

        if (document.getElementById('naukri-dot')) {
          if (data.isNaukriSessionSaved) {
            document.getElementById('naukri-dot').className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
            document.getElementById('naukri-auth-text').innerHTML = '<strong class="text-emerald-400">Session Active</strong> — Ready for daily 1-click boost';
            document.getElementById('naukri-action-tip').innerText = 'Session saved';
          } else if (data.hasNaukriPassword) {
            document.getElementById('naukri-dot').className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
            document.getElementById('naukri-auth-text').innerHTML = '<strong class="text-emerald-400">Auto-Login Enabled</strong> — NAUKRI_PASSWORD found';
            document.getElementById('naukri-action-tip').innerText = 'Autonomous';
          } else {
            document.getElementById('naukri-dot').className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
            document.getElementById('naukri-auth-text').innerHTML = '<span class="text-amber-300 font-semibold">Auth Required:</span> Run <code class="text-sky-300 font-mono">login_naukri.bat</code> or set <code class="text-sky-300 font-mono">NAUKRI_PASSWORD</code> in .env';
            document.getElementById('naukri-action-tip').innerHTML = '<a href="https://www.naukri.com/nlogin/login" target="_blank" class="text-sky-400 hover:underline">Log in now ↗</a>';
          }
        }

        if (document.getElementById('linkedin-dot')) {
          if (data.isLinkedInSessionSaved) {
            document.getElementById('linkedin-dot').className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
            document.getElementById('linkedin-auth-text').innerHTML = '<strong class="text-emerald-400">LinkedIn Active</strong> — Session saved';
          } else {
            document.getElementById('linkedin-dot').className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
            document.getElementById('linkedin-auth-text').innerHTML = '<span class="text-amber-300 font-semibold">LinkedIn:</span> Not saved yet';
          }
        }

        const isRunning = data.isRunning;
        const ind = document.getElementById('status-indicator');
        const title = document.getElementById('status-title');
        const badge = document.getElementById('badge-status');
        const stopBtn = document.getElementById('btn-stop');
        const jobCard = document.getElementById('current-job-card');

        if (isRunning) {
          ind.className = 'w-3.5 h-3.5 rounded-full bg-emerald-400 pulse-live';
          badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
          badge.innerText = 'Applying Active';
          title.innerText = data.statusText || 'Submitting Applications...';
          stopBtn.classList.remove('hidden');

          const pct = data.totalTarget > 0 ? Math.round((data.currentProgress / data.totalTarget) * 100) : 0;
          document.getElementById('progress-bar').style.width = pct + '%';
          document.getElementById('progress-label').innerText = data.currentProgress + ' / ' + data.totalTarget + ' Completed';
          document.getElementById('progress-percent').innerText = pct + '%';

          if (data.currentJob) {
            jobCard.classList.remove('hidden');
            document.getElementById('cj-title').innerText = data.currentJob.title;
            document.getElementById('cj-company').innerText = data.currentJob.companyName || data.currentJob.company;
            document.getElementById('cj-location').innerText = data.currentJob.location;
          }
        } else {
          ind.className = 'w-3.5 h-3.5 rounded-full bg-slate-600';
          badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700';
          badge.innerText = 'Engine Ready';
          title.innerText = data.statusText || 'Engine Idle';
          stopBtn.classList.add('hidden');
          jobCard.classList.add('hidden');
        }

        if (data.autopilot) {
          updateAutoPilotUI(data.autopilot);
        }

        // Render logs
        const logBox = document.getElementById('log-terminal');
        if (data.logs && data.logs.length > 0) {
          logBox.innerHTML = data.logs.map(l => '<div>' + l + '</div>').join('');
          logBox.scrollTop = logBox.scrollHeight;
        }

      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    let cachedLeads = [];
    let currentLeadFilter = 'ALL';

    function setLeadFilter(filter) {
      currentLeadFilter = filter;
      ['all', 'ta', 'hm', 'uncontacted'].forEach(f => {
        const btn = document.getElementById('filter-' + f);
        if (btn) {
          const isSelected = f.toUpperCase() === filter || (f === 'hm' && filter === 'HIRING_MANAGER');
          btn.className = isSelected
            ? 'px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-white border border-slate-600 shadow'
            : 'px-3 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white border border-transparent';
        }
      });
      renderLeads();
    }

    function renderLeads() {
      const tbody = document.getElementById('leads-table-body');
      if (!tbody) return;
      if (!cachedLeads || cachedLeads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-500">No leads extracted yet. Click "Fetch Leads" above!</td></tr>';
        return;
      }

      const filtered = cachedLeads.filter(l => {
        if (currentLeadFilter === 'TA') return l.contactType === 'TALENT_ACQUISITION' || /talent|recruiter|hr|ta|people/i.test(l.recruiterTitle || '');
        if (currentLeadFilter === 'HIRING_MANAGER') return l.contactType === 'HIRING_MANAGER' || /manager|lead|director|vp|head|architect/i.test(l.recruiterTitle || '');
        if (currentLeadFilter === 'UNCONTACTED') return l.status === 'UNCONTACTED';
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-500">No leads match the selected filter.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map(l => {
        const isContacted = l.status === 'CONTACTED';
        const isLinkedIn = (l.jobUrl && l.jobUrl.includes('linkedin.com')) || (l.sourcePortal && l.sourcePortal.toLowerCase().includes('linkedin'));
        const isNaukri = (l.jobUrl && l.jobUrl.includes('naukri.com')) || (l.sourcePortal && l.sourcePortal.toLowerCase().includes('naukri'));
        
        let linkButtonHtml = '<span class="text-slate-600 text-xs">—</span>';
        if (l.jobUrl && l.jobUrl.startsWith('http')) {
          if (isLinkedIn) {
            linkButtonHtml = '<a href="' + l.jobUrl + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0A66C2]/20 text-[#38bdf8] hover:bg-[#0A66C2]/35 border border-[#0A66C2]/50 transition shadow-sm" title="Open LinkedIn Job Post in new tab"><svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg><span>Apply on LinkedIn ↗</span></a>';
          } else if (isNaukri) {
            linkButtonHtml = '<a href="' + l.jobUrl + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/35 border border-indigo-500/40 transition shadow-sm" title="Open Naukri Job Post in new tab"><span>🔵 Apply on Naukri ↗</span></a>';
          } else {
            linkButtonHtml = '<a href="' + l.jobUrl + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-700/60 text-slate-200 hover:bg-slate-700 border border-slate-600 transition shadow-sm" title="Open Job Post in new tab"><span>🔗 View Job Post ↗</span></a>';
          }
        }

        const isHM = l.contactType === 'HIRING_MANAGER' || /manager|lead|director|vp|head|architect/i.test(l.recruiterTitle || '');
        const badgeTypeHtml = isHM
          ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">🚀 Hiring Manager</span>'
          : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">👔 TA Recruiter</span>';

        const nameWithLink = l.recruiterProfileUrl
          ? ('<a href="' + l.recruiterProfileUrl + '" target="_blank" rel="noopener noreferrer" class="text-white font-semibold hover:text-sky-300 transition inline-flex items-center gap-1" title="Open LinkedIn Profile">' + l.recruiterName + ' <span class="text-[10px] text-sky-400">↗</span></a>')
          : ('<span class="text-slate-200 font-semibold">' + l.recruiterName + '</span>');

        return \`
          <tr class="hover:bg-slate-800/40 transition">
            <td class="py-3 px-3 font-bold text-white truncate" title="\${l.company}">\${l.company}</td>
            <td class="py-3 px-3 overflow-hidden">
              <div class="text-slate-200 font-semibold truncate" title="\${l.title}">\${l.title}</div>
              <div class="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1"><span>🕒</span> <span>\${l.timePosted || 'Recently'}</span></div>
            </td>
            <td class="py-3 px-3 whitespace-nowrap">\${linkButtonHtml}</td>
            <td class="py-3 px-3 overflow-hidden">
              <div class="flex items-center gap-1.5 mb-1">\${badgeTypeHtml}</div>
              <div>\${nameWithLink}</div>
              <div class="text-[11px] text-slate-400 truncate mt-0.5" title="\${l.recruiterTitle}">\${l.recruiterTitle || (isHM ? 'Engineering Leader' : 'Technical Recruiter')}</div>
              <a href="mailto:\${l.targetEmail}" class="font-mono text-emerald-400 text-[11px] hover:underline block truncate mt-0.5" title="\${l.targetEmail}">\${l.targetEmail}</a>
            </td>
            <td class="py-3 px-3 whitespace-nowrap">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold \${isContacted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}">
                \${l.status}
              </span>
            </td>
            <td class="py-3 px-3 text-right whitespace-nowrap">
              <div class="flex items-center justify-end gap-1.5">
                \${l.applyStatus === 'APPLIED'
                  ? '<span class="px-2 py-1 rounded-md text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">✅ Applied</span>'
                  : ('<button onclick="applySingleLead(\\'' + l.id + '\\')" class="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition shadow flex items-center gap-1" title="Bot auto-applies & fills your profile">⚡ Apply</button>')
                }
                \${isContacted 
                  ? '<span class="px-1.5 py-1 text-xs text-slate-500 font-semibold">Sent</span>' 
                  : ('<button onclick="sendSingleEmail(\\'' + l.id + '\\')" class="px-2.5 py-1.5 rounded-lg ' + (isHM ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500') + ' text-white font-bold text-xs transition shadow flex items-center gap-1" title="' + (isHM ? 'Send technical manager pitch' : 'Send application pitch with resume') + '">✉️ ' + (isHM ? 'Email Manager' : 'Email TA') + '</button>')
                }
              </div>
            </td>
          </tr>
        \`;
      }).join('');
    }

    async function loadLeads() {
      try {
        const res = await fetch('/api/leads');
        cachedLeads = await res.json();
        renderLeads();
      } catch (e) {
        console.error('Failed to load leads:', e);
      }
    }

    async function applySingleLead(leadId) {
      if (!confirm('Auto-apply to this position using the job link and fill candidate details?')) return;
      try {
        const res = await fetch('/api/leads/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId })
        });
        const data = await res.json();
        alert('⚡ ' + (data.message || 'Auto-apply initiated! Watch the live execution feed below.'));
        setTimeout(loadLeads, 4000);
        fetchStatus();
      } catch (e) {
        alert('Apply error: ' + e.message);
      }
    }

    async function applyCustomUrl() {
      const urlInput = document.getElementById('custom-job-url');
      const companyInput = document.getElementById('custom-company-name');
      const titleInput = document.getElementById('custom-job-title');
      const visibleCheck = document.getElementById('custom-visible-browser');
      const btn = document.getElementById('btn-apply-custom-url');

      const jobUrl = urlInput ? urlInput.value.trim() : '';
      if (!jobUrl || !jobUrl.startsWith('http')) {
        alert('Please paste a valid job URL starting with http:// or https://');
        return;
      }

      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Starting...</span>';

      try {
        const res = await fetch('/api/leads/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobUrl,
            company: companyInput ? companyInput.value.trim() : '',
            title: titleInput ? titleInput.value.trim() : '',
            visible: !!(visibleCheck && visibleCheck.checked)
          })
        });
        const data = await res.json();
        if (data.success) {
          alert('🚀 Auto-apply initiated!\\n\\nWatch the Live Execution Log below to see candidate details and resume submitted in real-time.');
          if (urlInput) urlInput.value = '';
          if (companyInput) companyInput.value = '';
          if (titleInput) titleInput.value = '';
          fetchStatus();
        } else {
          alert('❌ Error: ' + (data.error || 'Failed to apply'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }

    async function applyBatchLeads(max = 5) {
      if (!confirm('Auto-apply to the top ' + max + ' job links and fill all candidate details?')) return;
      try {
        const res = await fetch('/api/leads/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: true, max })
        });
        const data = await res.json();
        alert('⚡ ' + (data.message || 'Batch auto-apply started! Watch the live execution feed below.'));
        setTimeout(loadLeads, 6000);
        fetchStatus();
      } catch (e) {
        alert('Apply error: ' + e.message);
      }
    }

    async function fetchRecruiterLeads() {
      try {
        const res = await fetch('/api/leads/fetch', { method: 'POST' });
        const data = await res.json();
        alert('🔍 Hunting recruiter contacts across LinkedIn & Naukri... Watch the live feed!');
        setTimeout(loadLeads, 4000);
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function sendSingleEmail(leadId) {
      if (!confirm('Send personalized cold email with your latest resume to this recruiter?')) return;
      try {
        const res = await fetch('/api/leads/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId })
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ Email sent successfully with resume attached!');
          loadLeads();
        } else {
          alert('Failed: ' + data.error);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function sendBatchOutreach(max = 5, filterType = 'ALL') {
      const typeLabel = filterType === 'TA' ? 'Talent Acquisition specialists' : (filterType === 'HIRING_MANAGER' ? 'Engineering Hiring Managers' : 'leads');
      if (!confirm('Send personalized cold emails with your latest resume to up to ' + max + ' ' + typeLabel + '?')) return;
      try {
        const res = await fetch('/api/leads/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: true, max, filterType })
        });
        const data = await res.json();
        alert('📬 Outreach batch started for ' + typeLabel + '! Watch the live terminal feed.');
        setTimeout(loadLeads, 6000);
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function deepUpgradeLeads() {
      if (!confirm('Deep Upgrade will inspect companies with generic careers@ emails, discover their actual Talent Acquisition specialists and Engineering/Data Managers on LinkedIn, and replace generic emails with verified direct contacts.\\n\\nStart Deep Upgrade?')) return;
      try {
        const res = await fetch('/api/leads/upgrade', { method: 'POST' });
        const data = await res.json();
        alert('🚀 Deep Upgrade started! Watch the Live Execution Feed below to see real TA and Hiring Managers added in real-time.');
        setTimeout(loadLeads, 6000);
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function sendFollowUps(max = 5) {
      if (!confirm('Send polite threaded follow-up emails (with 30-Day Notice) to recruiters contacted >= 2 days ago?')) return;
      try {
        const res = await fetch('/api/leads/follow-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max, days: 2 })
        });
        const data = await res.json();
        if (data.error) alert(data.error);
        else alert('📬 Follow-up campaign started! Watch the live terminal feed.');
        fetchStatus();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function runNaukriBoost(action = 'all', headless = false) {
      if (!confirm('Refresh Naukri.com profile (Resume Headline & Resume upload) to rank #1 in recruiter Resdex search?')) return;
      try {
        const res = await fetch('/api/naukri/rank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, headless })
        });
        const data = await res.json();
        if (data.error) alert(data.error);
        else alert('🚀 Naukri boost started! Watch the live terminal feed.');
        fetchStatus();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function openNaukriBrowser() {
      try {
        const res = await fetch('/api/naukri/open', { method: 'POST' });
        const data = await res.json();
        alert('🌐 Launching Naukri Profile in Chrome...');
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function applyNaukri(dailyMax = false) {
      const msg = dailyMax
        ? 'Start maximum daily apply sweep on Naukri & Career Sites (Target: up to 50 jobs / daily quota limit)?'
        : 'Start autonomous apply on Naukri & Career Sites for 0-5 YOE Data Engineer roles (Target: up to 20 jobs)?';
      if (!confirm(msg)) return;
      try {
        const res = await fetch('/api/naukri/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            maxApplications: dailyMax ? 50 : 20,
            dailyMax,
            allowCareerSites: true,
            minExp: 0,
            maxExp: 5
          })
        });
        const data = await res.json();
        alert('⚡ ' + (data.message || 'Naukri auto-apply initiated! Check live logs below.'));
        fetchStatus();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function applyLinkedIn() {
      if (!confirm('Start autonomous Easy Apply on LinkedIn for 2-5 YOE Data Engineer roles?')) return;
      try {
        const res = await fetch('/api/linkedin/apply', { method: 'POST' });
        const data = await res.json();
        alert('💼 ' + (data.message || 'LinkedIn auto-apply initiated! Check live logs below.'));
        fetchStatus();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function harvestGlassdoor() {
      try {
        const res = await fetch('/api/glassdoor/harvest', { method: 'POST' });
        const data = await res.json();
        alert('🔍 ' + (data.message || 'Harvesting Glassdoor jobs... Check live logs below.'));
        fetchStatus();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }


    async function startBatch(type, max, maxAgeHours) {
      if (!confirm('Start ' + type.toUpperCase() + ' batch for ' + max + ' jobs?')) return;
      try {
        const res = await fetch('/api/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchType: type, max, maxAgeHours })
        });
        const data = await res.json();
        if (data.error) alert(data.error);
        fetchStatus();
      } catch (e) {
        alert('Failed to start batch: ' + e.message);
      }
    }

    async function stopBatch() {
      if (!confirm('Abort active application batch?')) return;
      try {
        await fetch('/api/stop', { method: 'POST' });
        fetchStatus();
      } catch (e) {
        alert('Failed to stop: ' + e.message);
      }
    }

    async function openLinkedInBrowser() {
      const choice = prompt('LinkedIn Login Options:\\n\\n1. Press OK (leave "open") to launch the interactive Chromium window.\\n\\nOR\\n\\n2. If you already have LinkedIn open in your normal Chrome/Edge browser, paste your "li_at" cookie value here:', 'open');
      if (choice === null) return;
      const val = choice.trim();
      if (val !== 'open' && val.length > 15) {
        try {
          const res = await fetch('/api/linkedin/save-cookie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookie: val })
          });
          const data = await res.json();
          if (data.success) {
            alert('✅ LinkedIn session saved successfully! Bot is now authenticated.');
            fetchStatus();
          } else {
            alert('❌ ' + (data.error || 'Failed to save cookie'));
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
        return;
      }

      try {
        await fetch('/api/linkedin/open', { method: 'POST' });
        alert('🌐 Launching Chromium window!\\n\\n1. Look for a new Command Prompt / Chromium window on your screen or taskbar.\\n2. Log in with your email & password (or OTP).\\n3. Once feed loads, session saves automatically.\\n\\nTIP: You can also double-click "Login_LinkedIn.bat" directly from your Desktop!');
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }


    async function loadResumes() {
      try {
        const res = await fetch('/api/resumes');
        const data = await res.json();
        const display = document.getElementById('active-resume-display');
        const dropdown = document.getElementById('resume-select-dropdown');
        if (display && data.currentResume) {
          display.innerText = data.currentResume;
        }
        if (dropdown && data.resumes) {
          dropdown.innerHTML = data.resumes.map(r => 
            \`<option value="\${r.filename}" \${r.isActive ? 'selected' : ''}>Active: \${r.filename} (\${r.size})</option>\`
          ).join('');
        }


      } catch (e) {
        console.error('Failed to load resumes:', e);
      }
    }

    async function handleResumeUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Please select a PDF file (.pdf).');
        return;
      }

      const reader = new FileReader();
      reader.onload = async function() {
        try {
          const base64 = reader.result.split(',')[1];
          const res = await fetch('/api/resumes/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, base64 })
          });
          const data = await res.json();
          if (data.success) {
            alert('✅ ' + data.message);
            loadResumes();
            fetchStatus();
          } else {
            alert('Upload failed: ' + (data.error || 'Unknown error'));
          }
        } catch (err) {
          alert('Error uploading resume: ' + err.message);
        }
      };
      reader.readAsDataURL(file);
    }

    async function handleResumeSelect(filename) {
      if (!filename) return;
      try {
        const res = await fetch('/api/resumes/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename })
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ ' + data.message);
          loadResumes();
          fetchStatus();
        } else {
          alert('Select failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Error selecting resume: ' + err.message);
      }
    }

    async function handleResumeDelete() {
      const dropdown = document.getElementById('resume-select-dropdown');
      const filename = dropdown ? dropdown.value : '';
      if (!filename) {
        alert('Please select a resume to delete.');
        return;
      }
      if (!confirm('Are you sure you want to permanently delete "' + filename + '"?')) return;

      try {
        const res = await fetch('/api/resumes/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename })
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ ' + data.message);
          loadResumes();
          fetchStatus();
        } else {
          alert('Delete failed: ' + (data.error || 'Unknown error'));
        }
      } catch (e) {
        alert('Error deleting resume: ' + e.message);
      }
    }

    function updateAutoPilotUI(ap) {
      if (!ap) return;
      const badge = document.getElementById('ap-badge');
      const btnIcon = document.getElementById('ap-btn-icon');
      const btnText = document.getElementById('ap-btn-text');
      const btn = document.getElementById('btn-autopilot-toggle');
      const cyclesEl = document.getElementById('ap-cycles');
      const countdownEl = document.getElementById('ap-countdown');
      const summaryEl = document.getElementById('ap-last-summary');

      if (cyclesEl) cyclesEl.innerText = ap.cycleCount || 0;
      if (summaryEl && ap.lastSummary) summaryEl.innerText = ap.lastSummary;

      if (ap.isActive) {
        if (badge) {
          badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
          badge.innerText = ap.isCycleRunning ? 'Running Cycle...' : 'Active (Every 30m)';
        }
        if (btn) {
          btn.className = 'py-3 px-6 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-500 active:scale-[0.98] transition shadow-lg flex items-center gap-2 text-xs';
        }
        if (btnIcon) btnIcon.innerText = '⏸️';
        if (btnText) btnText.innerText = 'Stop Auto-Pilot';

        if (countdownEl) {
          if (ap.isCycleRunning) {
            countdownEl.innerText = 'Cycle in progress...';
          } else if (ap.secondsUntilNext !== undefined) {
            const mins = Math.floor(ap.secondsUntilNext / 60);
            const secs = ap.secondsUntilNext % 60;
            countdownEl.innerText = mins + 'm ' + (secs < 10 ? '0' : '') + secs + 's';
          }
        }
      } else {
        if (badge) {
          badge.className = 'text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700';
          badge.innerText = 'Stopped';
        }
        if (btn) {
          btn.className = 'py-3 px-6 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 active:scale-[0.98] transition shadow-lg flex items-center gap-2 text-xs';
        }
        if (btnIcon) btnIcon.innerText = '▶️';
        if (btnText) btnText.innerText = 'Start 30-Min Auto-Pilot';
        if (countdownEl) countdownEl.innerText = 'Inactive';
      }
    }

    async function toggleAutoPilot() {
      try {
        const res = await fetch('/api/autopilot/toggle', { method: 'POST' });
        const data = await res.json();
        updateAutoPilotUI(data);
        fetchStatus();
      } catch (e) {
        alert('Auto-pilot toggle error: ' + e.message);
      }
    }

    async function openSettingsModal() {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.credentials) {
          document.getElementById('set-naukri-email').value = data.credentials.naukriEmail || '';
          document.getElementById('set-naukri-pass').value = data.credentials.naukriPassword || '';
          document.getElementById('set-gmail-user').value = data.credentials.gmailUser || '';
          document.getElementById('set-gmail-pass').value = data.credentials.gmailAppPassword || '';
          document.getElementById('set-linkedin-email').value = data.credentials.linkedinEmail || '';
          document.getElementById('set-linkedin-pass').value = data.credentials.linkedinPassword || '';
          document.getElementById('set-gemini-key').value = data.credentials.geminiApiKey || '';
        }
        if (data.screening) {
          document.getElementById('set-notice-days').value = data.screening.noticePeriodDays || 15;
          document.getElementById('set-serving-notice').value = data.screening.servingNoticePeriod || 'No';
          document.getElementById('set-total-yoe').value = data.screening.totalYears || '2.8+';
          document.getElementById('set-current-ctc').value = data.screening.currentSalary || '10 LPA';
          document.getElementById('set-expected-ctc').value = data.screening.expectedSalary || '15 LPA';
          document.getElementById('set-current-company').value = data.screening.currentCompany || '';
          document.getElementById('set-current-title').value = data.screening.currentTitle || 'Data Engineer';
          document.getElementById('set-current-location').value = data.screening.currentLocation || 'Noida, India';
          document.getElementById('set-primary-skills').value = data.screening.primarySkills || '';
          document.getElementById('set-target-locations').value = data.screening.targetLocations || '';
        }
        document.getElementById('settings-modal').classList.remove('hidden');
      } catch (e) {
        alert('Failed to load settings: ' + e.message);
      }
    }

    function closeSettingsModal() {
      document.getElementById('settings-modal').classList.add('hidden');
    }

    async function saveSettings(e) {
      e.preventDefault();
      const payload = {
        credentials: {
          naukriEmail: document.getElementById('set-naukri-email').value.trim(),
          naukriPassword: document.getElementById('set-naukri-pass').value.trim(),
          gmailUser: document.getElementById('set-gmail-user').value.trim(),
          gmailAppPassword: document.getElementById('set-gmail-pass').value.trim(),
          linkedinEmail: document.getElementById('set-linkedin-email').value.trim(),
          linkedinPassword: document.getElementById('set-linkedin-pass').value.trim(),
          geminiApiKey: document.getElementById('set-gemini-key').value.trim()
        },
        screening: {
          noticePeriodDays: document.getElementById('set-notice-days').value.trim(),
          servingNoticePeriod: document.getElementById('set-serving-notice').value,
          totalYears: document.getElementById('set-total-yoe').value.trim(),
          currentSalary: document.getElementById('set-current-ctc').value.trim(),
          expectedSalary: document.getElementById('set-expected-ctc').value.trim(),
          currentCompany: document.getElementById('set-current-company').value.trim(),
          currentTitle: document.getElementById('set-current-title').value.trim(),
          currentLocation: document.getElementById('set-current-location').value.trim(),
          primarySkills: document.getElementById('set-primary-skills').value.trim(),
          targetLocations: document.getElementById('set-target-locations').value.trim()
        }
      };

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ ' + data.message);
          closeSettingsModal();
          fetchStatus();
        } else {
          alert('Save failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Error saving settings: ' + err.message);
      }
    }

    // Auto-poll status every 1.5s
    pollInterval = setInterval(fetchStatus, 1500);
    setInterval(loadLeads, 5000);
    fetchStatus();
    loadLeads();
    loadResumes();
  </script>

  <!-- Credentials & Screening Settings Modal -->
  <div id="settings-modal" class="hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
    <div class="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-6 shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-4 border-b border-slate-800">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">⚙️</span>
          <div>
            <h3 class="text-lg font-bold text-white">Credentials & Application Settings</h3>
            <p class="text-xs text-slate-400">Configure login credentials, notice period, CTC, and screening answers used dynamically during auto-apply.</p>
          </div>
        </div>
        <button onclick="closeSettingsModal()" class="text-slate-400 hover:text-white p-2 rounded-lg text-lg">✕</button>
      </div>

      <form id="settings-form" onsubmit="saveSettings(event)" class="mt-6 space-y-6">
        <!-- Section 1: Credentials -->
        <div>
          <h4 class="text-xs uppercase font-bold text-amber-400 tracking-wider mb-3 flex items-center gap-2">
            <span>🔐</span> Account Credentials (.env)
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Naukri Email</label>
              <input type="email" id="set-naukri-email" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Naukri Password</label>
              <input type="password" id="set-naukri-pass" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Gmail Address (for OTP & outreach)</label>
              <input type="email" id="set-gmail-user" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Gmail App Password (16 chars)</label>
              <input type="text" id="set-gmail-pass" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">LinkedIn Email (Optional)</label>
              <input type="email" id="set-linkedin-email" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">LinkedIn Password (Optional)</label>
              <input type="password" id="set-linkedin-pass" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none">
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs font-semibold text-slate-300 mb-1">Gemini API Key (Optional)</label>
              <input type="text" id="set-gemini-key" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none">
            </div>
          </div>
        </div>

        <!-- Section 2: Screening & Profile Answers -->
        <div class="border-t border-slate-800 pt-5">
          <h4 class="text-xs uppercase font-bold text-emerald-400 tracking-wider mb-3 flex items-center gap-2">
            <span>📋</span> Screening Q&A & Candidate Profile (config/profile.json)
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Notice Period (Effective Days)</label>
              <input type="number" id="set-notice-days" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Serving Notice?</label>
              <select id="set-serving-notice" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Total Experience (YOE)</label>
              <input type="text" id="set-total-yoe" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Current CTC</label>
              <input type="text" id="set-current-ctc" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Expected CTC</label>
              <input type="text" id="set-expected-ctc" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Current Company</label>
              <input type="text" id="set-current-company" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Current Title</label>
              <input type="text" id="set-current-title" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs font-semibold text-slate-300 mb-1">Current Location</label>
              <input type="text" id="set-current-location" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div class="md:col-span-3">
              <label class="block text-xs font-semibold text-slate-300 mb-1">Primary Skills</label>
              <input type="text" id="set-primary-skills" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
            <div class="md:col-span-3">
              <label class="block text-xs font-semibold text-slate-300 mb-1">Target Preferred Locations</label>
              <input type="text" id="set-target-locations" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none">
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <button type="button" onclick="closeSettingsModal()" class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition">Cancel</button>
          <button type="submit" class="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition shadow">💾 Save & Sync Settings</button>
        </div>
      </form>
    </div>
  </div>

</body>
</html>
`;
}
