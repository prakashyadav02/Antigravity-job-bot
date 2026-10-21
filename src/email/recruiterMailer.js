import nodemailer from 'nodemailer';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { getSavedLeads, saveLeads } from '../scrapers/recruiterFinder.js';
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
const OUTREACH_FILE = path.resolve(__dirname, '../../data/recruiter_outreach.json');

export function getOutreachHistory() {
  if (fs.existsSync(OUTREACH_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(OUTREACH_FILE, 'utf-8'));
    } catch {}
  }
  return [];
}

export function saveOutreachRecord(record) {
  const history = getOutreachHistory();
  history.push(record);
  fs.writeFileSync(OUTREACH_FILE, JSON.stringify(history, null, 2));
}

/**
 * Cleans corporate legal suffixes for friendly, conversational mention
 */
export function cleanCompanyName(raw) {
  if (!raw) return 'your team';
  return raw
    .replace(/\(.*?\)/g, '')
    .replace(/\b(Inc|Pvt|Ltd|Private|Limited|Technologies|Technology|Solutions|Software|Services|Systems|India|Corp|Corporation|LLC|Co)\b\.?/gi, '')
    .replace(/[.,\-_/\s]+$/g, '')
    .trim() || raw;
}

/**
 * Extracts Requisition / Job ID from URL or lead object across LinkedIn, Naukri, Workday, Lever, Greenhouse
 */
export function extractJobId(jobUrl, lead = {}) {
  if (lead && lead.jobId) return String(lead.jobId).trim();
  if (!jobUrl) return null;

  try {
    const urlObj = new URL(jobUrl);
    for (const key of ['jobId', 'currentJobId', 'gh_jid', 'id', 'reqId', 'job_id', 'ref', 'requisitionId']) {
      const val = urlObj.searchParams.get(key);
      if (val && /^[a-zA-Z0-9\-_]{4,}$/.test(val)) return val;
    }
  } catch {}

  // LinkedIn job ID: /jobs/view/(.*-)?(\d{8,12})/
  const liMatch = jobUrl.match(/\/jobs\/view\/(?:[^\/]+-)?(\d{8,12})/i);
  if (liMatch) return liMatch[1];

  // Naukri job ID: trailing digits in job-listings (e.g. 180926016268)
  const naukriMatch = jobUrl.match(/job-listings-.*?-(\d{8,14})(?:\?|$)/i);
  if (naukriMatch) return naukriMatch[1];

  // Workday requisition ID: (R-\d+|JR\d+|REQ-\d+) preceded by _, -, /, or word boundary
  const reqMatch = jobUrl.match(/(?:[_\-\/]|\b)(R[-_]?\d{4,8}|JR\d{4,8}|REQ[-_]?\d{4,8})\b/i);
  if (reqMatch) return reqMatch[1];

  // General trailing path number (digits 5-14)
  const generalNum = jobUrl.match(/\/(\d{5,14})(?:\/|\?|$)/);
  if (generalNum) return generalNum[1];

  // UUID match (e.g. Lever/Ashby)
  const uuidMatch = jobUrl.match(/\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\/|\?|$)/);
  if (uuidMatch) return uuidMatch[1];

  return null;
}

/**
 * Checks whether an email is a generic company mailbox (careers@, jobs@, hr@, etc.)
 * versus an individual professional (Aishwarya Shetty, Ishaan Kakkar, etc.)
 */
export function isGenericCareerEmail(email) {
  if (!email) return false;
  const local = email.split('@')[0].toLowerCase().trim();
  return /^(careers?|jobs?|recruitment|talent|hr|info|contact|apply|hiring)$/i.test(local);
}

/**
 * Analyzes lead context to identify domain and technical focus
 */
export function detectDomainFocus(lead) {
  const combined = `${lead.title || ''} ${lead.company || ''} ${lead.domain || ''} ${lead.jdSnippet || ''}`.toLowerCase();

  if (/databricks|spark|pyspark|big\s*data|hadoop/.test(combined)) {
    return 'DATABRICKS_SPARK';
  }
  if (/airflow|kafka|stream|streaming|event|real[- ]time/.test(combined)) {
    return 'ORCHESTRATION_STREAMING';
  }
  if (/aws|s3|cloud|parquet|lakehouse|data\s*lake|warehouse|snowflake|redshift/.test(combined)) {
    return 'CLOUD_DATA_LAKE';
  }
  if (/sql|postgres|database|dbt|incremental/.test(combined)) {
    return 'SQL_ETL';
  }
  return 'GENERAL_DATA_ENG';
}

/**
 * Generates tailored hook aligned with Data Engineering
 */
export function generatePersonalizedPitch(lead) {
  const focus = detectDomainFocus(lead);
  const companyName = cleanCompanyName(lead.company);

  switch (focus) {
    case 'DATABRICKS_SPARK':
      return {
        hook: `Seeing <strong>${companyName}</strong>'s emphasis on high-throughput data processing, my hands-on optimization work—fine-tuning distributed PySpark transformations, partition-aware processing, and Databricks workflows—enables me to contribute immediately to your big data workloads.`,
        bullet1: `<strong>Distributed Processing & PySpark:</strong> Engineered large-scale ETL pipelines on Apache Spark & Databricks clusters, tuning shuffle partitions and memory serialization to minimize job latency.`,
        bullet2: `<strong>Data Lake & Storage:</strong> Optimized Delta Lake / Parquet file storage on cloud object stores with partition pruning and watermark-based loading for rapid analytical queries.`
      };

    case 'ORCHESTRATION_STREAMING':
      return {
        hook: `Given <strong>${companyName}</strong>'s focus on scalable data orchestration and real-time streaming, my background in designing resilient Apache Airflow DAGs and Kafka ingestion pipelines aligns directly with your platform standards.`,
        bullet1: `<strong>Event Streaming & Kafka:</strong> Built real-time stream ingestion pipelines using Apache Kafka, managing consumer offsets, high-volume message throughput, and schema evolution.`,
        bullet2: `<strong>Workflow Orchestration:</strong> Designed resilient Apache Airflow DAGs with idempotent tasks, automated retries, failure alerting, and SLA tracking.`
      };

    case 'CLOUD_DATA_LAKE':
      return {
        hook: `I noticed your team at <strong>${companyName}</strong> works with modern cloud data architectures. In my day-to-day work, I organize AWS S3 data lakes across raw, processed, and curated layers using Parquet to guarantee query performance and storage efficiency.`,
        bullet1: `<strong>Cloud Data Architecture:</strong> Structured AWS S3 multi-tier data lakes (raw, processed, curated) leveraging Snappy-compressed Parquet for storage efficiency.`,
        bullet2: `<strong>Scalable Ingestion & Loading:</strong> Automated distributed data ingestion workflows feeding analytical warehouses with partition-aware optimization.`
      };

    case 'SQL_ETL':
      return {
        hook: `With <strong>${companyName}</strong>'s focus on reliable data transformation and high-integrity analytics, my experience developing robust ETL pipelines, optimizing SQL queries, and implementing watermark-based incremental loading adds immediate value.`,
        bullet1: `<strong>Database Optimization & SQL:</strong> Architected high-throughput data sync engines and complex SQL query tuning across PostgreSQL, SQL Server, and NoSQL stores (MongoDB).`,
        bullet2: `<strong>Incremental Loading:</strong> Designed watermark-based CDC pipelines ensuring zero data loss, exact schema validation, and high data integrity.`
      };

    case 'GENERAL_DATA_ENG':
    default:
      return {
        hook: `I noticed your engineering team at <strong>${companyName}</strong> is expanding its core data platform. My experience building scalable ETL pipelines, optimizing Spark processing efficiency, and orchestrating production workflows positions me to hit the ground running with your team.`,
        bullet1: `<strong>Data Pipelines & Ingestion:</strong> Built production ETL pipelines with PySpark & Databricks, partition-aware optimization, and watermark-based incremental loading.`,
        bullet2: `<strong>Workflow Orchestration & Cloud:</strong> Designed Apache Airflow DAGs with automated retries and failure monitoring; structured AWS S3 data lakes (raw/processed/curated) with Parquet.`
      };
  }
}

/**
 * Creates concise, high-converting email HTML content tailored specifically
 * for either Talent Acquisition Specialists or Engineering/Data Hiring Managers
 */
export function generateRecruiterEmail(lead) {
  const profile = loadProfile();
  const firstName = profile.personal?.firstName || 'Candidate';
  const lastName = profile.personal?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const title = profile.experience?.currentTitle || 'Data Engineer';
  const yoe = profile.experience?.totalYears || '2.8+';
  const skills = profile.customAnswers?.primarySkills || 'Python, SQL, PySpark, Apache Spark, Databricks, Apache Airflow, AWS S3';
  const noticeDays = profile.workPreferences?.effectiveNoticePeriodDays || 15;
  const phone = profile.personal?.phone || '+91 9220299305';
  const email = profile.personal?.email || 'yadavparkash02@gmail.com';
  const linkedin = profile.links?.linkedin || '';
  const github = profile.links?.github || '';

  const companyName = cleanCompanyName(lead.company);
  const jobId = extractJobId(lead.jobUrl, lead);
  const isPerson = !isGenericCareerEmail(lead.targetEmail);
  const isTA = lead.contactType === 'TALENT_ACQUISITION' || /talent|recruiter|hr|ta|people|staffing/i.test(lead.recruiterTitle || '');
  const isHiringManager = !isTA && (lead.contactType === 'HIRING_MANAGER' || /manager|lead|director|vp|head|architect/i.test(lead.recruiterTitle || ''));
  const pitch = generatePersonalizedPitch(lead);

  let formattedFirst = 'Hiring Team';
  if (lead.recruiterName && !/hiring|recruiter|team|manager/i.test(lead.recruiterName)) {
    const rawFirst = lead.recruiterName.trim().split(' ')[0].toLowerCase();
    formattedFirst = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1);
  }

  const jobLinkHtml = lead.jobUrl 
    ? `<a href="${lead.jobUrl}" target="_blank" rel="noopener noreferrer" style="color: #2b6cb0; text-decoration: underline;"><strong>${lead.title}</strong></a>` 
    : `<strong>${lead.title}</strong>`;
  const jobIdMention = jobId ? ` (Job ID / Req #${jobId})` : '';

  let subject = '';
  let greeting = '';
  let openingParagraph = '';
  let referralCtaParagraph = '';

  if (isHiringManager && isPerson) {
    subject = `Data Engineering on your team${jobId ? ` [Req #${jobId}]` : ''} — ${fullName} (${yoe} Yrs | PySpark, Airflow, SQL)`;
    greeting = `Hi ${formattedFirst},`;
    openingParagraph = `I came across your profile as an engineering leader at <strong>${companyName}</strong>. I noticed the open position for ${jobLinkHtml}${jobIdMention} and wanted to reach out directly regarding engineering opportunities with your team.`;
    referralCtaParagraph = `
      <p style="margin-bottom: 16px;">
        I have attached my latest resume for your review. If you are directly leading this opening, I would welcome the opportunity to connect for a brief 5-10 minute conversation next week. <strong>If this position is hired by another engineering manager or team at ${companyName}, could you please share my resume with the suitable contact or consider referring me internally for this opening?</strong>
      </p>
    `;
  } else if (isPerson) {
    // Human TA Recruiter or HR Specialist
    subject = `Application for ${lead.title}${jobId ? ` [Req #${jobId}]` : ''} — ${fullName} (${yoe} Yrs | 15 Days Notice)`;
    greeting = formattedFirst !== 'Hiring Team' ? `Hi ${formattedFirst},` : `Hi ${companyName} Talent Acquisition Team,`;
    openingParagraph = `I noticed the open position for ${jobLinkHtml}${jobIdMention} at <strong>${companyName}</strong> and am writing to express my strong interest in joining your engineering team.`;
    referralCtaParagraph = `
      <p style="margin-bottom: 16px;">
        I have attached my latest resume for your review and am available to join within a <strong>15-day notice period</strong>. If you are the recruiter leading this search, I would welcome the opportunity to discuss my fit for the role. <strong>If this opening is managed by another recruiter or engineering hiring manager on your team, could you please share my resume with the suitable contact or consider referring me for this position?</strong>
      </p>
    `;
  } else {
    // Generic corporate career inbox (careers@, jobs@, hr@)
    subject = `Application for ${lead.title}${jobId ? ` [Req #${jobId}]` : ''} — ${fullName} (${yoe} Yrs | 15 Days Notice)`;
    greeting = `Hi ${companyName} Talent Acquisition Team,`;
    openingParagraph = `Please find attached my application for the <strong>${lead.title}</strong> position at <strong>${companyName}</strong>.`;
    referralCtaParagraph = `
      <p style="margin-bottom: 16px;">
        I have attached my latest resume for your review. I am readily available to join within a <strong>15-day notice period</strong> and would welcome the opportunity to discuss how my data engineering experience can add immediate value to ${companyName}.
      </p>
    `;
  }

  const jobReferenceBox = (lead.jobUrl || jobId) ? `
    <div style="background-color: #f7fafc; border-left: 3px solid #3182ce; padding: 10px 14px; margin: 14px 0; border-radius: 4px; font-size: 13px; line-height: 1.5;">
      <div><strong>Target Role:</strong> ${lead.jobUrl ? `<a href="${lead.jobUrl}" target="_blank" rel="noopener noreferrer" style="color: #2b6cb0; text-decoration: underline;"><strong>${lead.title}</strong></a>` : `<strong>${lead.title}</strong>`}</div>
      ${jobId ? `<div style="margin-top: 3px;"><strong>Job / Requisition ID:</strong> <span style="font-family: monospace; color: #2d3748; background-color: #edf2f7; padding: 1px 5px; border-radius: 3px;">${jobId}</span></div>` : ''}
      ${lead.jobUrl ? `<div style="margin-top: 3px;"><strong>Job Posting Link:</strong> <a href="${lead.jobUrl}" target="_blank" rel="noopener noreferrer" style="color: #2b6cb0; word-break: break-all; text-decoration: underline;">${lead.jobUrl}</a></div>` : ''}
    </div>
  ` : '';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #2d3748; max-width: 620px;">
      <p style="margin-bottom: 14px;">${greeting}</p>
      
      <p style="margin-bottom: 12px;">
        ${openingParagraph}
      </p>

      ${jobReferenceBox}

      <p style="margin-bottom: 12px;">
        I am a <strong>${title} with ${yoe} years of experience</strong> engineering scalable batch & streaming ETL pipelines, distributed processing workflows, and cloud data lakes using <strong>Python, SQL, PySpark, Apache Spark, Databricks, Airflow, and AWS S3</strong>.
      </p>

      <p style="margin-bottom: 12px;">
        ${pitch.hook}
      </p>

      <p style="margin-bottom: 6px;"><strong>Core Technical Highlights:</strong></p>
      <ul style="padding-left: 20px; margin: 0 0 14px 0;">
        <li style="margin-bottom: 4px;">${pitch.bullet1}</li>
        <li style="margin-bottom: 4px;">${pitch.bullet2}</li>
      </ul>

      ${referralCtaParagraph}

      <p style="margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 14px; color: #4a5568;">
        Best regards,<br>
        <strong style="color: #1a202c; font-size: 15px;">${fullName}</strong><br>
        ${title}<br>
        📞 ${phone} | ✉️ <a href="mailto:${email}" style="color: #2b6cb0; text-decoration: none;">${email}</a><br>
        ${linkedin ? `<a href="${linkedin}" style="color: #2b6cb0; text-decoration: none;">LinkedIn</a>` : ''}
        ${github ? ` | <a href="${github}" style="color: #2b6cb0; text-decoration: none;">GitHub</a>` : ''}
      </p>
    </div>
  `;

  return { subject, html };
}

/**
 * Sends personalized cold email with resume attached via Gmail SMTP
 */
export async function sendColdEmailToRecruiter(lead) {
  // Safety Shield: Guarantee current employer & affiliated entities are NEVER emailed
  if (isCompanyExcluded(lead.company, `${lead.domain} ${lead.targetEmail}`)) {
    console.error(`🛡️ [BLOCKED] Refused to send outreach to excluded employer: ${lead.company} (${lead.targetEmail})`);
    throw new Error(`Outreach blocked: ${lead.company} is on your excluded employers list.`);
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('Gmail credentials missing in .env');
  }

  const domain = (lead.targetEmail || '').split('@')[1];
  if (!domain) {
    throw new Error(`Invalid email address format: ${lead.targetEmail}`);
  }

  // Pre-flight DNS MX verification to prevent sending to dead domains
  try {
    const mxRecords = await dns.promises.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      throw new Error(`Domain "${domain}" has no active mail servers (MX records).`);
    }
  } catch (dnsErr) {
    throw new Error(`Cannot send to ${lead.targetEmail}: Domain "${domain}" has no active mail server (${dnsErr.code || dnsErr.message})`);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  const { subject, html } = generateRecruiterEmail(lead);

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

  console.log(`[Recruiter Mailer] Dispatching email to: ${lead.targetEmail} (${lead.company})...`);

  const info = await transporter.sendMail({
    from: `"${fullName}" <${user}>`,
    to: lead.targetEmail,
    subject,
    html,
    attachments
  });

  console.log(`✅ [Recruiter Mailer] Sent successfully to ${lead.targetEmail}! (ID: ${info.messageId})`);

  // Record outreach
  const record = {
    id: `outreach_${Date.now()}`,
    leadId: lead.id,
    company: lead.company,
    title: lead.title,
    recipientEmail: lead.targetEmail,
    recruiterName: lead.recruiterName,
    jobUrl: lead.jobUrl || '',
    jobId: extractJobId(lead.jobUrl, lead) || '',
    contactType: lead.contactType || '',
    sentAt: new Date().toISOString(),
    messageId: info.messageId
  };
  saveOutreachRecord(record);

  // Update lead status in recruiter_leads.json (strictly by lead ID or exact recipient email)
  const leads = getSavedLeads();
  const target = leads.find(l => l.id === lead.id || (l.targetEmail && l.targetEmail.toLowerCase() === (lead.targetEmail || '').toLowerCase()));
  if (target) {
    target.status = 'CONTACTED';
    target.contactedAt = new Date().toISOString();
    saveLeads(leads);
  }

  return record;
}

/**
 * Sends cold emails to a batch of uncontacted leads with safe pacing
 * Can filter by 'ALL', 'TA' (Talent Acquisition only), or 'HIRING_MANAGER' only.
 */
export async function sendBatchRecruiterOutreach(maxCount = 10, filterType = 'ALL') {
  const leads = getSavedLeads();
  const uncontacted = leads.filter(l => {
    if (l.status !== 'UNCONTACTED' || !l.targetEmail) return false;
    if (isCompanyExcluded(l.company, `${l.domain || ''} ${l.targetEmail}`)) return false;

    if (filterType === 'TA') {
      return l.contactType === 'TALENT_ACQUISITION' || /talent|recruiter|hr|ta|people/i.test(l.recruiterTitle || '');
    }
    if (filterType === 'HIRING_MANAGER') {
      return l.contactType === 'HIRING_MANAGER' || /manager|lead|director|vp|head|architect/i.test(l.recruiterTitle || '');
    }
    return true;
  });

  console.log(`\n📬 [Recruiter Outreach] Starting batch outreach (Max: ${maxCount} | Filter: ${filterType})...`);
  console.log(`Total uncontacted leads matching filter: ${uncontacted.length}`);

  const toSend = uncontacted.slice(0, maxCount);
  const sent = [];

  for (let i = 0; i < toSend.length; i++) {
    const lead = toSend[i];
    console.log(`\n[${i + 1}/${toSend.length}] Outreach for ${lead.company} (${lead.title})...`);

    try {
      const record = await sendColdEmailToRecruiter(lead);
      sent.push(record);

      if (i < toSend.length - 1) {
        console.log('⏳ Waiting 6 seconds before next recruiter email to simulate natural sending...');
        await randomSleep(5000, 8000);
      }
    } catch (e) {
      console.error(`❌ Failed to send to ${lead.targetEmail}:`, e.message);
    }
  }

  console.log(`\n🎉 [Outreach Complete] Sent ${sent.length} personalized cold emails with resume attached!`);
  return sent;
}
