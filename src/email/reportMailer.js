import nodemailer from 'nodemailer';
import 'dotenv/config';
import { loadProfile } from '../config.js';

/**
 * Sends a daily execution summary email to the user via Gmail SMTP.
 */
export async function sendDailySummaryEmail(report) {
  let candidateName = 'Candidate';
  try {
    const prof = loadProfile();
    candidateName = `${prof.personal?.firstName || ''} ${prof.personal?.lastName || ''}`.trim() || candidateName;
  } catch {}
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.log('[Mailer] Gmail credentials not set, skipping email dispatch.');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  const { date, appliedCount, applications = [], failed = [] } = report;

  const rows = applications.map((app, i) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 12px; font-weight: bold;">${i + 1}</td>
      <td style="padding: 10px 12px; color: #1a202c; font-weight: 600;">${app.company}</td>
      <td style="padding: 10px 12px;"><a href="${app.url}" style="color: #3182ce; text-decoration: none;">${app.title}</a></td>
      <td style="padding: 10px 12px; color: #4a5568;">${app.platform}</td>
      <td style="padding: 10px 12px; color: #38a169; font-weight: bold;">SUBMITTED</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #2b6cb0; margin-top: 0;">🚀 Daily Job Auto-Pilot Report</h2>
      <p style="color: #4a5568; font-size: 14px;"><strong>Date:</strong> ${date} | <strong>Status:</strong> Completed</p>
      <div style="background-color: #ebf8ff; border-left: 4px solid #3182ce; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <p style="margin: 0; color: #2b6cb0; font-size: 15px;">
          <strong>${appliedCount} new applications</strong> submitted autonomously with your latest resume.
        </p>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
        <thead>
          <tr style="background-color: #f7fafc; border-bottom: 2px solid #cbd5e0;">
            <th style="padding: 10px 12px;">#</th>
            <th style="padding: 10px 12px;">Company</th>
            <th style="padding: 10px 12px;">Role</th>
            <th style="padding: 10px 12px;">ATS</th>
            <th style="padding: 10px 12px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length > 0 ? rows : '<tr><td colspan="5" style="padding: 12px; text-align: center; color: #718096;">No new jobs met criteria today.</td></tr>'}
        </tbody>
      </table>

      ${failed.length > 0 ? `
        <div style="margin-top: 20px; padding: 12px; background-color: #fffaf0; border: 1px solid #feebc8; border-radius: 6px;">
          <h4 style="margin: 0 0 8px 0; color: #c05621;">⚠️ Skipped / Unresolved Positions (${failed.length}):</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #744210;">
            ${failed.map(f => `<li>${f.title} @ ${f.company} - <em>${f.reason}</em></li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
        <p style="margin: 0;">Sent automatically by Antigravity Autonomous Job Bot for ${candidateName}.</p>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Job Bot Auto-Pilot" <${user}>`,
      to: user,
      subject: `🎯 Daily Job Bot Summary: ${appliedCount} Applications Submitted (${date})`,
      html
    });
    console.log(`📧 [Mailer] Daily summary email dispatched successfully! (Message ID: ${info.messageId})`);
  } catch (err) {
    console.error(`❌ [Mailer Error]:`, err.message);
  }
}
