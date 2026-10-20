import nodemailer from 'nodemailer';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { getOutreachHistory, cleanCompanyName } from './recruiterMailer.js';
import { randomSleep } from '../automation/browser.js';
import { isCompanyExcluded, loadProfile } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export function getResumePath() {
  try {
    const profile = loadProfile();
    if (profile?.documents?.resumePath) return profile.documents.resumePath;
  } catch {}
  return path.resolve(__dirname, '../../data/Prakash-Kumar-Yadav-Resume.pdf');
}
const FOLLOWUPS_FILE = path.resolve(__dirname, '../../data/recruiter_followups.json');

/**
 * Returns all recorded follow-ups
 */
export function getFollowUpHistory() {
  if (fs.existsSync(FOLLOWUPS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(FOLLOWUPS_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Saves a follow-up record to disk
 */
export function saveFollowUpRecord(record) {
  const history = getFollowUpHistory();
  history.push(record);
  fs.writeFileSync(FOLLOWUPS_FILE, JSON.stringify(history, null, 2));
}

/**
 * Identifies outreach records that were sent >= minDays ago with no follow-up yet
 */
export function getEligibleFollowUps(minDays = 2) {
  const outreachList = getOutreachHistory();
  const followUps = getFollowUpHistory();
  const now = Date.now();

  const followedUpIds = new Set(followUps.map(f => f.outreachId || f.leadId));
  const followedUpEmails = new Set(followUps.map(f => (f.recipientEmail || '').toLowerCase()));

  const eligible = [];

  for (const item of outreachList) {
    if (!item.recipientEmail || !item.sentAt) continue;

    // Safety Shield Check
    if (isCompanyExcluded(item.company, item.recipientEmail)) {
      continue;
    }

    // Check if already followed up
    if (followedUpIds.has(item.id) || followedUpIds.has(item.leadId) || followedUpEmails.has(item.recipientEmail.toLowerCase())) {
      continue;
    }

    const sentTime = new Date(item.sentAt).getTime();
    const ageDays = (now - sentTime) / (1000 * 60 * 60 * 24);

    if (ageDays >= minDays) {
      eligible.push({
        ...item,
        ageDays: Math.floor(ageDays * 10) / 10
      });
    }
  }

  return eligible;
}

/**
 * Generates high-converting, polite threaded follow-up email content
 */
export function generateFollowUpEmail(outreach) {
  const profile = loadProfile();
  const firstName = profile.personal?.firstName || 'Candidate';
  const lastName = profile.personal?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const title = profile.experience?.currentTitle || profile.workPreferences?.targetRoles?.[0] || 'Data Engineer';
  const yoe = profile.experience?.totalYears || '2.8+';
  const skills = profile.customAnswers?.primarySkills || 'Python, PySpark, SQL, Airflow, Spark';
  const noticeDays = profile.workPreferences?.effectiveNoticePeriodDays || 15;
  const phone = profile.personal?.phone || '';
  const email = profile.personal?.email || '';
  const linkedin = profile.links?.linkedin || '';
  const github = profile.links?.github || '';

  const companyName = cleanCompanyName(outreach.company);
  
  let greeting = `Hi ${companyName} Hiring Team,`;
  if (outreach.recruiterName && !/hiring|recruiter|team|manager/i.test(outreach.recruiterName)) {
    const rawFirst = outreach.recruiterName.trim().split(' ')[0].toLowerCase();
    const formattedFirst = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1);
    greeting = `Hi ${formattedFirst},`;
  }

  const subject = `Re: [${noticeDays} Days Notice] Application for ${outreach.title} — ${fullName}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #2d3748; max-width: 650px;">
      <p>${greeting}</p>
      
      <p>
        I hope you are having a productive week.
      </p>

      <p>
        I wanted to briefly follow up on my previous note regarding the <strong>${outreach.title}</strong> role at <strong>${companyName}</strong>. I remain very enthusiastic about the work your engineering team is doing and would welcome the opportunity to connect.
      </p>

      <p>
        <strong>Quick updates & key qualifications:</strong>
      </p>
      <ul style="padding-left: 20px;">
        <li>
          <strong>Notice Period:</strong> Readily available to join within ${noticeDays} days (negotiable / buyout possible).
        </li>
        <li>
          <strong>Hands-On Experience:</strong> ${yoe} years of production engineering experience with <strong>${skills}</strong>.
        </li>
        <li>
          <strong>System Focus:</strong> Proven track record building reliable data processing pipelines, ETL workflows, and scalable architectures.
        </li>
      </ul>

      <p>
        I would love to set up a quick 10-15 minute introductory call this week at your convenience. I have re-attached my updated resume for quick reference.
      </p>

      <p>
        Thank you for your time and consideration!
      </p>

      <p style="margin-top: 24px;">
        Best regards,<br>
        <strong>${fullName}</strong><br>
        ${title}<br>
        📞 ${phone} | ✉️ ${email}<br>
        ${linkedin ? `<a href="${linkedin}" style="color: #2b6cb0; text-decoration: none;">LinkedIn</a>` : ''}
        ${github ? ` | <a href="${github}" style="color: #2b6cb0; text-decoration: none;">GitHub</a>` : ''}
      </p>
    </div>
  `;

  return { subject, html };
}

/**
 * Sends a single threaded follow-up email via Gmail SMTP
 */
export async function sendFollowUpEmail(outreach, options = {}) {
  // Safety Shield
  if (isCompanyExcluded(outreach.company, outreach.recipientEmail)) {
    console.error(`🛡️ [BLOCKED] Refused follow-up to excluded employer: ${outreach.company}`);
    throw new Error(`Follow-up blocked: ${outreach.company} is on excluded employers list.`);
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('Gmail credentials missing in .env');
  }

  const domain = (outreach.recipientEmail || '').split('@')[1];
  if (!domain) {
    throw new Error(`Invalid email address format: ${outreach.recipientEmail}`);
  }

  // Pre-flight DNS MX verification
  try {
    const mxRecords = await dns.promises.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      throw new Error(`Domain "${domain}" has no active mail servers.`);
    }
  } catch (dnsErr) {
    throw new Error(`Cannot follow up with ${outreach.recipientEmail}: Domain "${domain}" has no active mail server (${dnsErr.code || dnsErr.message})`);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  const { subject, html } = generateFollowUpEmail(outreach);

  const profile = loadProfile();
  const firstName = profile.personal?.firstName || 'Candidate';
  const lastName = profile.personal?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const resumePath = getResumePath();

  const attachments = [];
  if (fs.existsSync(resumePath)) {
    attachments.push({
      filename: path.basename(resumePath),
      path: resumePath
    });
  }

  console.log(`[Follow-Up Engine] Dispatching threaded follow-up to: ${outreach.recipientEmail} (${outreach.company})...`);

  const mailOptions = {
    from: `"${fullName}" <${user}>`,
    to: outreach.recipientEmail,
    subject,
    html,
    attachments
  };

  // Threading headers if original messageId is available
  if (outreach.messageId) {
    mailOptions.inReplyTo = outreach.messageId;
    mailOptions.references = outreach.messageId;
  }

  const info = await transporter.sendMail(mailOptions);

  console.log(`✅ [Follow-Up Engine] Follow-up sent to ${outreach.recipientEmail}! (ID: ${info.messageId})`);

  const record = {
    id: `followup_${Date.now()}`,
    outreachId: outreach.id,
    leadId: outreach.leadId,
    company: outreach.company,
    title: outreach.title,
    recipientEmail: outreach.recipientEmail,
    recruiterName: outreach.recruiterName,
    originalSentAt: outreach.sentAt,
    followUpSentAt: new Date().toISOString(),
    messageId: info.messageId,
    threadMessageId: outreach.messageId || null
  };

  saveFollowUpRecord(record);
  return record;
}

/**
 * Sends a batch of automated follow-ups to eligible candidates
 */
export async function sendBatchFollowUps(options = {}) {
  const { maxCount = 5, minDays = 2, force = false } = options;

  const eligible = getEligibleFollowUps(force ? 0 : minDays);
  console.log(`\n📬 [Follow-Up Engine] Discovered ${eligible.length} eligible candidates for follow-up (Sent >= ${minDays} days ago).`);

  if (eligible.length === 0) {
    console.log('No follow-ups due at this time. All outreach is fresh or already followed up.');
    return [];
  }

  const toSend = eligible.slice(0, maxCount);
  const sent = [];

  for (let i = 0; i < toSend.length; i++) {
    const item = toSend[i];
    console.log(`\n[${i + 1}/${toSend.length}] Following up with ${item.company} (${item.title}) — Original outreach sent ${item.ageDays} days ago...`);

    try {
      const record = await sendFollowUpEmail(item);
      sent.push(record);

      if (i < toSend.length - 1) {
        console.log('⏳ Waiting 6 seconds before next follow-up to simulate natural human pacing...');
        await randomSleep(5000, 8000);
      }
    } catch (e) {
      console.error(`❌ Failed follow-up to ${item.recipientEmail}:`, e.message);
    }
  }

  console.log(`\n🎉 [Follow-Up Engine Complete] Sent ${sent.length} threaded follow-ups with resume attached!`);
  return sent;
}
