import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

async function scanInbox() {
  console.log('📬 Connecting to Gmail IMAP to scan emails from the last 48 hours...');
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com',
      pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '')
    },
    logger: false
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    // 48 hours ago
    const sinceDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    console.log(`Searching messages since: ${sinceDate.toISOString()} (IST: ${sinceDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`);

    const messages = client.fetch({ since: sinceDate }, { envelope: true, bodyStructure: true, source: true });
    const emailList = [];

    for await (const msg of messages) {
      try {
        const parsed = await simpleParser(msg.source);
        const fromName = parsed.from?.value?.[0]?.name || '';
        const fromAddress = parsed.from?.value?.[0]?.address || '';
        const subject = parsed.subject || '(No Subject)';
        const date = parsed.date || msg.envelope?.date;
        const textSnippet = (parsed.text || '').replace(/\s+/g, ' ').slice(0, 300);

        emailList.push({
          date,
          dateStr: date ? new Date(date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Unknown',
          from: `${fromName} <${fromAddress}>`.trim(),
          fromAddress,
          subject,
          snippet: textSnippet
        });
      } catch (err) {
        console.warn('Error parsing message:', err.message);
      }
    }

    console.log(`\nFound total ${emailList.length} emails in the last 48 hours.\n`);

    // Sort by date descending (newest first)
    emailList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // Print all emails
    emailList.forEach((e, idx) => {
      console.log(`[${idx + 1}] ${e.dateStr} | ${e.from}`);
      console.log(`    Subject: ${e.subject}`);
      console.log(`    Preview: ${e.snippet.slice(0, 150)}...`);
      console.log('----------------------------------------------------');
    });

  } finally {
    lock.release();
    await client.logout();
  }
}

scanInbox().catch(console.error);
