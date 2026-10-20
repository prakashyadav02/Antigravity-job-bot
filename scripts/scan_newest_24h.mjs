import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

async function scanTopRecent() {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com', pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
    const messages = client.fetch({ since: sinceDate }, { envelope: true, source: true });
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
      } catch (err) {}
    }

    emailList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    console.log(`\n=== LAST 24 HOURS EMAILS (${emailList.length} total) ===\n`);
    emailList.slice(0, 20).forEach((e, idx) => {
      console.log(`[${idx + 1}] ${e.dateStr} | ${e.from}`);
      console.log(`    📌 Subject: ${e.subject}`);
      console.log(`    💬 Preview: ${e.snippet.slice(0, 160)}...`);
      console.log('----------------------------------------------------------------------');
    });

  } finally {
    lock.release();
    await client.logout();
  }
}

scanTopRecent().catch(console.error);
