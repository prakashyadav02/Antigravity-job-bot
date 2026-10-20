import 'dotenv/config';
import { ImapFlow } from 'imapflow';

async function checkConfirmations() {
  const email = process.env.GMAIL_USER;
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
    console.warn(`[Check Confirmations IMAP Warning]: ${err.code || err.message}`);
  });

  console.log(`Connecting to Gmail IMAP for ${email}...`);
  await client.connect();
  console.log('Connected! Scanning for job confirmations in the last 48 hours...\n');

  const lock = await client.getMailboxLock('INBOX');
  try {
    const sinceDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const messages = client.fetch({ since: sinceDate }, { envelope: true });

    const jobEmails = [];

    for await (const msg of messages) {
      const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
      const fromName = msg.envelope?.from?.[0]?.name || '';
      const subject = msg.envelope?.subject || '';
      const date = msg.envelope?.date ? new Date(msg.envelope.date) : new Date();

      const text = `${fromAddr} ${fromName} ${subject}`.toLowerCase();
      if (
        text.includes('greenhouse') ||
        text.includes('gitlab') ||
        text.includes('alphasense') ||
        text.includes('inmobi') ||
        text.includes('lever') ||
        text.includes('application') ||
        text.includes('applying') ||
        text.includes('verification') ||
        text.includes('security code')
      ) {
        jobEmails.push({
          from: `${fromName} <${fromAddr}>`,
          subject,
          date,
          id: msg.uid
        });
      }
    }

    jobEmails.sort((a, b) => b.date - a.date);

    console.log(`=== Found ${jobEmails.length} relevant emails in the last 48 hours ===\n`);
    jobEmails.forEach((mail, idx) => {
      console.log(`${idx + 1}. [${mail.date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}]`);
      console.log(`   From:    ${mail.from}`);
      console.log(`   Subject: ${mail.subject}\n`);
    });

  } finally {
    lock.release();
    await client.logout();
  }
}

checkConfirmations().catch(console.error);
