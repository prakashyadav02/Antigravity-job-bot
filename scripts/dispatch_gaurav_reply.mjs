import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESUME_PATH = path.resolve(__dirname, '../data/Vivek-Chowdhary-Resume.pdf');

async function sendReply() {
  console.log('🚀 Preparing to dispatch email to Gaurav Giri...');
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
  const inReplyTo = '<BMXPR01MB2823C98572BA90D23EFF5C0FAD8A2@BMXPR01MB2823.INDPRD01.PROD.OUTLOOK.COM>';

  const textBody = `Hi Gaurav,

Thank you for your email and for sharing your booking link.

I am scheduling a quick discussion slot for today around 5:00 PM IST using your link.

If this timing is suitable for you, I look forward to speaking with you today. In case you are unavailable today due to the holiday, please let me know or feel free to suggest an alternative slot as per your availability, and I will gladly adjust.

Thank you, and looking forward to connecting with you.

Best regards,
Vivek Kumar Chowdhary
Java Backend Developer / SDE-II
📞 +91-7003322903 | ✉️ vivekchaudhary538@gmail.com
LinkedIn: https://www.linkedin.com/in/vivek-chowdhary-725087203/`;

  const htmlBody = `
<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #222;">
  <p>Hi Gaurav,</p>

  <p>Thank you for your email and for sharing your booking link.</p>

  <p>I am scheduling a quick discussion slot for <strong>today around 5:00 PM IST</strong> using your link.</p>

  <p>If this timing is suitable for you, I look forward to speaking with you today. In case you are unavailable today due to the holiday, please let me know or feel free to suggest an <strong>alternative slot as per your availability</strong>, and I will gladly adjust.</p>

  <p>Thank you, and looking forward to connecting with you.</p>

  <br>
  <p style="margin-bottom: 2px;">Best regards,</p>
  <p style="margin-top: 0; font-weight: bold; color: #1a56db; font-size: 15px;">Vivek Kumar Chowdhary</p>
  <p style="margin: 0; color: #555;">Java Backend Developer / SDE-II</p>
  <p style="margin: 0; color: #555;">📞 +91-7003322903 | ✉️ <a href="mailto:vivekchaudhary538@gmail.com">vivekchaudhary538@gmail.com</a></p>
  <p style="margin: 0; color: #555;">LinkedIn: <a href="https://www.linkedin.com/in/vivek-chowdhary-725087203/">linkedin.com/in/vivek-chowdhary-725087203/</a></p>
</div>`;

  const mailOptions = {
    from: `"Vivek Chowdhary" <${user}>`,
    to: recipient,
    subject: subject,
    text: textBody,
    html: htmlBody,
    inReplyTo: inReplyTo,
    references: inReplyTo,
    attachments: [
      {
        filename: 'Vivek-Chowdhary-Resume.pdf',
        path: RESUME_PATH
      }
    ]
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully! Message-ID: ${info.messageId}`);
  } catch (error) {
    console.error('❌ Failed to send email:', error);
    process.exit(1);
  }
}

sendReply().catch(console.error);
