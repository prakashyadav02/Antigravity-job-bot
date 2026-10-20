import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

async function main() {
  const email = process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com';
  const appPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!email || !appPassword) {
    console.error('Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env');
    return;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false
  });

  client.on('error', err => {
    console.warn(`[IMAP Warning]: ${err.message}`);
  });

  console.log(`Connecting to Gmail for ${email}...`);
  await client.connect();
  console.log('Connected! Searching for emails from or mentioning "Gaurav"...');

  const lock = await client.getMailboxLock('INBOX');
  try {
    // Look back last 14 days
    const sinceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const messages = client.fetch({ since: sinceDate }, { envelope: true, source: true });

    const matchedEmails = [];

    for await (const msg of messages) {
      const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
      const fromName = (msg.envelope?.from?.[0]?.name || '').toLowerCase();
      const subject = (msg.envelope?.subject || '').toLowerCase();

      const isMatch = fromAddr.includes('gaurav') || fromName.includes('gaurav') || subject.includes('gaurav');

      if (isMatch) {
        let bodyText = '';
        if (msg.source) {
          try {
            const parsed = await simpleParser(msg.source);
            bodyText = parsed.text || parsed.html || '';
          } catch (e) {
            bodyText = '(Could not parse body: ' + e.message + ')';
          }
        }

        matchedEmails.push({
          uid: msg.uid,
          date: msg.envelope?.date,
          from: `${msg.envelope?.from?.[0]?.name || ''} <${msg.envelope?.from?.[0]?.address || ''}>`,
          subject: msg.envelope?.subject,
          bodySnippet: bodyText.trim().slice(0, 1500)
        });
      }
    }

    console.log(`\nFound ${matchedEmails.length} emails matching "Gaurav":\n`);
    matchedEmails.sort((a, b) => new Date(b.date) - new Date(a.date));

    for (const em of matchedEmails) {
      console.log('================================================================');
      console.log(`📅 Date: ${em.date}`);
      console.log(`👤 From: ${em.from}`);
      console.log(`📌 Subject: ${em.subject}`);
      console.log(`✉️ Message Preview:\n${em.bodySnippet}`);
      console.log('================================================================\n');
    }

    if (matchedEmails.length === 0) {
      console.log('No direct sender/subject match. Let us do a deeper search in recent 30 emails for any mention of Gaurav inside the body...');
      const recentMessages = client.fetch({ since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, { envelope: true, source: true });
      for await (const msg of recentMessages) {
        if (msg.source) {
          try {
            const parsed = await simpleParser(msg.source);
            const fullText = (parsed.text || '') + ' ' + (parsed.subject || '');
            if (fullText.toLowerCase().includes('gaurav')) {
              console.log('------------------------------------------------');
              console.log(`Found mention in email from: ${msg.envelope?.from?.[0]?.name} <${msg.envelope?.from?.[0]?.address}>`);
              console.log(`Date: ${msg.envelope?.date}`);
              console.log(`Subject: ${msg.envelope?.subject}`);
              console.log(`Body Snippet:\n${(parsed.text || '').trim().slice(0, 1000)}`);
              console.log('------------------------------------------------\n');
            }
          } catch {}
        }
      }
    }

  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch(console.error);
