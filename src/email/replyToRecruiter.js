import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESUME_PATH = path.resolve(__dirname, '../../data/Vivek-Chowdhary-Resume.pdf');
const SCREENING_PATH = path.resolve(__dirname, '../../config/screening_details.json');
const OUTREACH_FILE = path.resolve(__dirname, '../../data/recruiter_outreach.json');

/**
 * Loads screening details from config
 */
export function getScreeningDetails() {
  if (fs.existsSync(SCREENING_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(SCREENING_PATH, 'utf-8'));
    } catch {}
  }
  return {};
}

/**
 * Generates a polished candidate evaluation response email
 */
export function generateCandidateDetailsHtml(recruiterName = 'Gaurav', companyName = 'InterraIT') {
  const d = getScreeningDetails();

  const text = `Hi ${recruiterName},

Thank you for getting back to me. I appreciate your team taking the time to review my profile for the Java Developer position at ${companyName}.

Please find the requested details below for your evaluation:

• Full Name: ${d.fullName}
• Total Experience: ${d.totalExperience}
• Relevant Experience (Java / Spring Boot / Microservices / Java+AI): ${d.relevantExperience}
• Current CTC: ${d.currentCTC}
• Expected CTC: ${d.expectedCTC}
• Offer in Hand: ${d.offerInHand}
• Current Location: ${d.currentLocation}
• Preferred Work Location: ${d.preferredWorkLocations}
• Current Company Name: ${d.currentCompany}
• If C2H – Payroll Company Name: ${d.payrollCompany}
• Official Notice Period: ${d.officialNoticePeriod}
• Serving Notice Period / LWD: ${d.servingNoticePeriod}
• Contact Number: ${d.contactNumber}
• Email Address: ${d.emailAddress}
• LinkedIn: ${d.linkedin}
• Portfolio: ${d.portfolio}
• GitHub: ${d.github}

I have also attached my latest resume for your review. Please let me know if any further details are required or if we can connect for a brief discussion regarding the next steps.

Looking forward to your response.

Best regards,
${d.fullName}
Data Engineer
📞 ${d.contactNumber} | ✉️ ${d.emailAddress}
`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #2d3748; max-width: 680px;">
      <p>Hi ${recruiterName},</p>
      
      <p>
        Thank you for getting back to me. I truly appreciate your team taking the time to review my profile for the <strong>Data Engineer</strong> position at <strong>${companyName}</strong>.
      </p>

      <p>Please find the requested details below for your evaluation:</p>

      <table style="border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13.5px; width: 100%; max-width: 650px; margin: 16px 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <tbody>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; width: 42%;">Full Name:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b; font-weight: 500;">${d.fullName}</td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Total Experience:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.totalExperience}</td></tr>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Relevant Experience:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.relevantExperience}</td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Current CTC:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b; font-weight: 600;">${d.currentCTC}</td></tr>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Expected CTC:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b; font-weight: 600;">${d.expectedCTC}</td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Offer in Hand:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.offerInHand}</td></tr>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Current Location:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.currentLocation}</td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Preferred Work Location:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.preferredWorkLocations}</td></tr>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Current Company:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.currentCompany} (${d.employmentType})</td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Payroll Company (if C2H):</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.payrollCompany}</td></tr>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Official Notice Period:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b; font-weight: 600;">${d.officialNoticePeriod}</td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Serving Notice Period / LWD:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.servingNoticePeriod}</td></tr>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Contact Number:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${d.contactNumber}</td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">Email Address:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #1e293b;"><a href="mailto:${d.emailAddress}" style="color: #2563eb;">${d.emailAddress}</a></td></tr>
          <tr style="background: #f8fafc;"><td style="padding: 9px 14px; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0;">LinkedIn Profile:</td><td style="padding: 9px 14px; border-bottom: 1px solid #e2e8f0;"><a href="${d.linkedin}" style="color: #2563eb; text-decoration: none;">${d.linkedin}</a></td></tr>
          <tr><td style="padding: 9px 14px; font-weight: 600; color: #475569;">GitHub:</td><td style="padding: 9px 14px;"><a href="${d.github}" style="color: #2563eb; text-decoration: none;">${d.github}</a></td></tr>
        </tbody>
      </table>

      <p>
        I have also re-attached my latest resume for your review. Please let me know if you need any additional information, or if we can connect for a brief call regarding the next steps.
      </p>

      <p>Looking forward to hearing from you.</p>

      <p style="margin-top: 24px;">
        Best regards,<br>
        <strong>${d.fullName}</strong><br>
        Data Engineer<br>
        📞 ${d.contactNumber} | ✉️ ${d.emailAddress}<br>
        🔗 <a href="${d.linkedin}" style="color: #2b6cb0;">LinkedIn</a> | 
        <a href="${d.github}" style="color: #2b6cb0;">GitHub</a>
      </p>
    </div>
  `;

  return { text, html };
}

/**
 * Sends threaded reply to recruiter
 */
export async function replyToGauravInterraIT() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!user || !pass) {
    throw new Error('Gmail credentials missing in .env');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  const { text, html } = generateCandidateDetailsHtml('Gaurav', 'InterraIT');
  const recipient = 'GauravG@ferfier.com';
  const subject = 'Re: Application: Java Developer — Vivek Chowdhary (Java / Spring Boot / SDE-II)';
  const messageId = '<BMXPR01MB28230887C6D0B87FFA54B703AD8B2@BMXPR01MB2823.INDPRD01.PROD.OUTLOOK.COM>';

  const attachments = [];
  if (fs.existsSync(RESUME_PATH)) {
    attachments.push({
      filename: 'Vivek-Chowdhary-Resume.pdf',
      path: RESUME_PATH
    });
  }

  console.log(`[Reply Mailer] Sending threaded response to: ${recipient}...`);

  const info = await transporter.sendMail({
    from: `"Vivek Kumar Chowdhary" <${user}>`,
    to: recipient,
    subject,
    inReplyTo: messageId,
    references: messageId,
    text,
    html,
    attachments
  });

  console.log(`✅ [Reply Mailer] Successfully sent reply to Gaurav Giri! (Message ID: ${info.messageId})`);

  // Record in outreach log
  const record = {
    id: `reply_${Date.now()}`,
    type: 'RECRUITER_REPLY_SUBMITTED',
    company: 'InterraIT (Ferfier Group)',
    recipientEmail: recipient,
    recruiterName: 'Gaurav Giri',
    subject,
    sentAt: new Date().toISOString(),
    messageId: info.messageId
  };

  if (fs.existsSync(OUTREACH_FILE)) {
    try {
      const history = JSON.parse(fs.readFileSync(OUTREACH_FILE, 'utf-8'));
      history.push(record);
      fs.writeFileSync(OUTREACH_FILE, JSON.stringify(history, null, 2));
    } catch {}
  }

  return record;
}
