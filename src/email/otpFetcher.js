import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

/**
 * Polls Gmail via IMAP specifically and ONLY for Greenhouse/ATS security verification codes.
 * Strict privacy guarantee:
 * - Only queries messages from `greenhouse.io` or `lever.co`.
 * - Only queries messages received within the last 5 minutes.
 * - Discards all other email data immediately.
 * 
 * @param {Object} options
 * @param {string} options.email - Gmail address (e.g. vivekchaudhary538@gmail.com)
 * @param {string} options.appPassword - Google 16-character App Password
 * @param {number} [options.timeoutMs=60000] - Max polling duration in milliseconds
 * @param {number} [options.submittedAfter] - Epoch ms timestamp when form was submitted
 * @returns {Promise<string|null>} 8-character verification code or null if not found
 */
export async function fetchGreenhouseOtp({ email, appPassword, timeoutMs = 60000, submittedAfter = null }) {
  if (!email || !appPassword) {
    console.warn('[OTP Fetcher] Missing Gmail address or App Password. Cannot fetch OTP automatically.');
    return null;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: email,
      pass: appPassword.replace(/\s+/g, '') // remove spaces from 16-char app password if any
    },
    logger: false
  });

  client.on('error', err => {
    console.warn(`[OTP Fetcher IMAP Warning]: ${err.code || err.message}`);
  });

  const startTime = Date.now();
  const effectiveSubmittedAfter = submittedAfter || (Date.now() - 60000);
  console.log(`[OTP Fetcher] Connecting to Gmail IMAP for ${email}...`);

  try {
    await client.connect();
    console.log('[OTP Fetcher] Connected to Gmail. Monitoring for incoming Greenhouse security code...');

    const sinceDate = new Date(Date.now() - 3 * 60 * 1000); // Look back 3 minutes

    while (Date.now() - startTime < timeoutMs) {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // STRICT FILTER: Only emails from greenhouse.io or lever.co received recently
        const searchCriteria = {
          since: sinceDate,
          or: [
            { from: 'greenhouse.io' },
            { from: 'lever.co' },
            { body: 'verification code' },
            { body: 'security code' }
          ]
        };

        const matchingItems = [];
        const messages = client.fetch(searchCriteria, { source: true, envelope: true });
        for await (const msg of messages) {
          matchingItems.push(msg);
        }

        // Sort newest first
        matchingItems.sort((a, b) => {
          const dateA = a.envelope?.date ? new Date(a.envelope.date).getTime() : 0;
          const dateB = b.envelope?.date ? new Date(b.envelope.date).getTime() : 0;
          return dateB - dateA;
        });

        for (const msg of matchingItems) {
          const msgDate = msg.envelope?.date ? new Date(msg.envelope.date).getTime() : Date.now();
          // Skip if message was received before the form was submitted (with 15s leeway for clock skew)
          if (msgDate < effectiveSubmittedAfter - 15000) {
            continue;
          }
          const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
          const subject = (msg.envelope?.subject || '').toLowerCase();

          // Privacy Check: Ensure sender or subject is strictly related to ATS verification
          const isJobRelated = fromAddr.includes('greenhouse.io') || 
                               fromAddr.includes('lever.co') || 
                               subject.includes('verification code') || 
                               subject.includes('security code');

          if (!isJobRelated) {
            continue; // STRICT PRIVACY: Ignore all other emails completely
          }

          const parsed = await simpleParser(msg.source);
          const html = parsed.html || '';

          // Greenhouse security code is always wrapped in <h1>XXXXXXXX</h1>
          const h1Match = html.match(/<h1[^>]*>\s*([a-zA-Z0-9]{8})\s*<\/h1>/i);
          if (h1Match && h1Match[1]) {
            const code = h1Match[1].trim();
            console.log(`[OTP Fetcher] Found Greenhouse security code: ${code}`);
            return code;
          }

          // Fallback pattern if HTML not present
          const textMatch = (parsed.text || '').match(/([a-zA-Z0-9]{8})/);
          if (textMatch && textMatch[1]) {
            console.log(`[OTP Fetcher] Found code in text: ${textMatch[1]}`);
            return textMatch[1];
          }
        }
      } finally {
        lock.release();
      }

      console.log('[OTP Fetcher] Waiting for security email to land (checking again in 4s)...');
      await new Promise(r => setTimeout(r, 4000));
    }

    console.warn('[OTP Fetcher] Timed out waiting for verification email.');
    return null;
  } catch (err) {
    console.error('[OTP Fetcher] Error checking email:', err.message);
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}
