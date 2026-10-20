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
 * Creates concise, high-converting recruiter email HTML content
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
  
  let greeting = `Hi ${companyName} Hiring Team,`;
  if (lead.recruiterName && !/hiring|recruiter|team|manager/i.test(lead.recruiterName)) {
    const rawFirst = lead.recruiterName.trim().split(' ')[0].toLowerCase();
    const formattedFirst = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1);
    greeting = `Hi ${formattedFirst},`;
  }

  const pitch = generatePersonalizedPitch(lead);
  const subject = `Application for ${lead.title} — ${fullName} (${yoe} Yrs | Python, PySpark, SQL, Airflow)`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #2d3748; max-width: 620px;">
      <p style="margin-bottom: 14px;">${greeting}</p>
      
      <p style="margin-bottom: 12px;">
        I noticed the opening for <strong>${lead.title}</strong> at <strong>${companyName}</strong> and am writing to express my strong interest in joining your engineering team.
      </p>

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

      <p style="margin-bottom: 16px;">
        I have attached my latest resume for your review. I would welcome the opportunity to discuss how my data engineering experience can add immediate value to ${companyName}.
      </p>

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
    sentAt: new Date().toISOString(),
    messageId: info.messageId
  };
  saveOutreachRecord(record);

  // Update lead status in recruiter_leads.json
  const leads = getSavedLeads();
  const target = leads.find(l => l.id === lead.id || l.jobUrl === lead.jobUrl);
  if (target) {
    target.status = 'CONTACTED';
    target.contactedAt = new Date().toISOString();
    saveLeads(leads);
  }

  return record;
}

/**
 * Sends cold emails to a batch of uncontacted leads with safe pacing
 */
export async function sendBatchRecruiterOutreach(maxCount = 10) {
  const leads = getSavedLeads();
  const uncontacted = leads.filter(l => 
    l.status === 'UNCONTACTED' && 
    l.targetEmail && 
    !isCompanyExcluded(l.company, `${l.domain || ''} ${l.targetEmail}`)
  );

  console.log(`\n📬 [Recruiter Outreach] Starting batch email outreach (Max: ${maxCount})...`);
  console.log(`Total uncontacted leads available: ${uncontacted.length}`);

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
