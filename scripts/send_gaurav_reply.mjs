import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESUME_PATH = path.resolve(__dirname, '../data/Vivek-Chowdhary-Resume.pdf');

async function sendReply() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!user || !pass) {
    console.error('Error: Missing Gmail credentials in .env');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  const recipient = 'Gaurav Giri <GauravG@ferfier.com>';
  const subject = 'Re: Application: Java Developer — Vivek Chowdhary (Java / Spring Boot / SDE-II)';
  const inReplyTo = '<BMXPR01MB28230935A08D0CF35499B34EAD8B2@BMXPR01MB2823.INDPRD01.PROD.OUTLOOK.COM>';

  const textBody = `Hi Gaurav,

Thank you for the transparent update and for reviewing my profile.

I wanted to quickly clarify two points regarding the joining timeline and compensation:

1. Joining Timeline (20–30 Days):
While the formal HR policy states 60 days, I have already discussed early release options with my team. Through leave adjustment and standard buyout options, I can comfortably join within 20 to 30 days (or even earlier if critical for the project).

2. Compensation (Flexible & Budget-Aligned):
The numbers shared earlier were only indicative. I am fully flexible and happy to align with InterraIT’s approved budget and internal bands for this position, as I am genuinely excited about the work your digital engineering team is doing.

Given my 3+ years of hands-on experience across Java (8, 11, and 17), Spring Boot microservices, high-throughput distributed systems, and Cloud/AI integrations, I can hit the ground running and add immediate value to your project.

Looking forward to hearing from you.

Best regards,
Vivek Kumar Chowdhary
SDE-II / Java Backend Developer
📞 +91-7003322903 | ✉️ vivekchaudhary538@gmail.com
LinkedIn: https://www.linkedin.com/in/vivek-chowdhary-725087203/
Portfolio: https://mrvivek30.github.io/`;

  const htmlBody = `
<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #222;">
  <p>Hi Gaurav,</p>

  <p>Thank you for the transparent update and for reviewing my profile.</p>

  <p>I wanted to quickly clarify two points regarding the joining timeline and compensation:</p>

  <ol style="padding-left: 20px;">
    <li style="margin-bottom: 12px;">
      <strong>Joining Timeline (20–30 Days):</strong><br>
      While the formal HR policy states 60 days, I have already discussed early release options with my team. Through leave adjustment and standard buyout options, <strong>I can comfortably join within 20 to 30 days</strong> (or even earlier if critical for the project).
    </li>
    <li style="margin-bottom: 12px;">
      <strong>Compensation (Flexible & Budget-Aligned):</strong><br>
      The numbers shared earlier were only indicative. I am <strong>fully flexible and happy to align with InterraIT’s approved budget and internal bands</strong> for this position, as I am genuinely excited about the work your digital engineering team is doing.
    </li>
  </ol>

  <p>Given my 3+ years of hands-on experience across <strong>Java (8, 11, and 17), Spring Boot microservices, high-throughput distributed systems, and Cloud/AI integrations</strong>, I can hit the ground running and add immediate value to your project.</p>

  <p>Looking forward to hearing from you.</p>

  <p style="margin-top: 25px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
    <strong>Vivek Kumar Chowdhary</strong><br>
    <span style="color: #555;">SDE-II / Java Backend Developer</span><br>
    📞 <a href="tel:+917003322903" style="color: #0366d6; text-decoration: none;">+91-7003322903</a> | ✉️ <a href="mailto:vivekchaudhary538@gmail.com" style="color: #0366d6; text-decoration: none;">vivekchaudhary538@gmail.com</a><br>
    🔗 <a href="https://www.linkedin.com/in/vivek-chowdhary-725087203/" style="color: #0366d6; text-decoration: none;">LinkedIn Profile</a> | <a href="https://mrvivek30.github.io/" style="color: #0366d6; text-decoration: none;">Portfolio</a>
  </p>
</div>
`;

  const attachments = [];
  if (fs.existsSync(RESUME_PATH)) {
    attachments.push({
      filename: 'Vivek-Chowdhary-Resume.pdf',
      path: RESUME_PATH
    });
  }

  const mailOptions = {
    from: `"Vivek Chowdhary" <${user}>`,
    to: recipient,
    subject,
    text: textBody,
    html: htmlBody,
    inReplyTo,
    references: inReplyTo,
    attachments
  };

  console.log(`Sending reply to ${recipient}...`);
  const info = await transporter.sendMail(mailOptions);
  console.log('✅ Email successfully delivered!');
  console.log(`Message ID: ${info.messageId}`);
  console.log(`Response: ${info.response}`);
}

sendReply().catch(err => {
  console.error('❌ Failed to send reply:', err);
  process.exit(1);
});
