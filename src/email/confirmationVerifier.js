import { ImapFlow } from 'imapflow';
import 'dotenv/config';

/**
 * Normalizes company name for fuzzy matching in email sender and subject
 */
function cleanCompanyName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\b(india|technologies|technology|pvt|ltd|limited|inc|corp|llc|software|solutions|services)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Polls Gmail specifically for an incoming application confirmation receipt
 * from the employer or ATS for the role just submitted.
 *
 * @param {Object} options
 * @param {string} options.companyName - Name of the company applied to (e.g. "Deliveroo", "MongoDB")
 * @param {string} options.jobTitle - Title of the job (e.g. "Staff Software Engineer")
 * @param {number} options.submittedAfter - Timestamp (ms) right before form was submitted
 * @param {number} [options.timeoutSeconds=90] - Max wait time in seconds (default: 90s)
 * @returns {Promise<{ confirmed: boolean, subject?: string, from?: string, receivedAt?: string, error?: string }>}
 */
export async function waitForConfirmationEmail(options = {}) {
  const {
    companyName = '',
    jobTitle = '',
    submittedAfter = Date.now() - 30000,
    timeoutSeconds = 90
  } = options;

  const email = process.env.GMAIL_USER;
  const appPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!email || !appPassword) {
    return { confirmed: false, error: 'Gmail credentials missing in .env' };
  }

  const cleanComp = cleanCompanyName(companyName);
  console.log(`\n=============================================================`);
  console.log(`📬 [Confirmation Verifier] Waiting for site confirmation email...`);
  console.log(`Target Employer: "${companyName}" (Pattern: "${cleanComp}")`);
  console.log(`Role: "${jobTitle}"`);
  console.log(`Max Wait Time: ${timeoutSeconds}s | Polling Gmail IMAP every 6s`);
  console.log(`Rule: Will NOT proceed to next job until verified email arrives.`);
  console.log(`=============================================================\n`);

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false
  });

  client.on('error', err => {
    console.warn(`[Confirmation Verifier IMAP Warning]: ${err.code || err.message}`);
  });

  const startTime = Date.now();
  const maxWaitMs = timeoutSeconds * 1000;
  // Allow 20s clock skew
  const effectiveMinTime = submittedAfter - 20000;

  try {
    await client.connect();
    console.log(`[Confirmation Verifier] Connected to Gmail. Monitoring for incoming receipt...`);

    while (Date.now() - startTime < maxWaitMs) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const lock = await client.getMailboxLock('INBOX');

      try {
        const sinceDate = new Date(Date.now() - 5 * 60 * 1000); // last 5 minutes
        const messages = client.fetch({ since: sinceDate }, { envelope: true });
        const matchingMessages = [];

        for await (const msg of messages) {
          const msgDate = msg.envelope?.date ? new Date(msg.envelope.date).getTime() : Date.now();
          if (msgDate < effectiveMinTime) continue;

          const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
          const fromName = (msg.envelope?.from?.[0]?.name || '').toLowerCase();
          const subject = (msg.envelope?.subject || '').toLowerCase();
          const fullText = `${fromAddr} ${fromName} ${subject}`;

          // Confirmation keywords
          const isConfirmationType = 
            subject.includes('thank you for applying') ||
            subject.includes('thanks for applying') ||
            subject.includes('thank you for your application') ||
            subject.includes('application received') ||
            subject.includes('received your application') ||
            subject.includes('application confirmed') ||
            subject.includes('confirm your application') ||
            subject.includes('application submission') ||
            subject.includes('we have received') ||
            subject.includes('we received') ||
            subject.includes('acknowledgement') ||
            (subject.includes('application') && !subject.includes('security code') && !subject.includes('verification code'));

          // Company or ATS match
          const matchesCompany = 
            cleanComp.length > 2 && (
              fullText.includes(cleanComp) || 
              fromAddr.includes(cleanComp) || 
              fromName.includes(cleanComp) || 
              subject.includes(cleanComp)
            );

          const matchesAts = 
            fromAddr.includes('greenhouse-mail.io') ||
            fromAddr.includes('greenhouse.io') ||
            fromAddr.includes('lever.co') ||
            fromAddr.includes('ashbyhq.com') ||
            fromAddr.includes('smartrecruiters.com');

          if (isConfirmationType && (matchesCompany || matchesAts)) {
            matchingMessages.push({
              subject: msg.envelope.subject,
              from: `${msg.envelope.from?.[0]?.name || ''} <${msg.envelope.from?.[0]?.address || ''}>`.trim(),
              date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : new Date().toISOString()
            });
          }
        }

        if (matchingMessages.length > 0) {
          const match = matchingMessages[0];
          console.log(`\n🎉 [CONFIRMED!] Official application receipt detected in inbox!`);
          console.log(`   From: ${match.from}`);
          console.log(`   Subject: "${match.subject}"`);
          console.log(`   Received: ${match.date}`);
          console.log(`   Time elapsed: ${elapsedSec}s\n`);
          return {
            confirmed: true,
            subject: match.subject,
            from: match.from,
            receivedAt: match.date
          };
        }

      } finally {
        lock.release();
      }

      console.log(`[Confirmation Verifier] Waiting for email receipt from ${companyName}... (${elapsedSec}s / ${timeoutSeconds}s)`);
      // Wait 6 seconds before next poll
      await new Promise(r => setTimeout(r, 6000));
    }

    console.warn(`\n⚠️ [Confirmation Timeout] No confirmation email received from ${companyName} within ${timeoutSeconds}s.`);
    return {
      confirmed: false,
      error: `No confirmation email received from ${companyName} within ${timeoutSeconds} seconds.`
    };

  } catch (err) {
    console.error(`❌ [Confirmation Verifier Error]:`, err.message);
    return { confirmed: false, error: err.message };
  } finally {
    await client.logout().catch(() => {});
  }
}
