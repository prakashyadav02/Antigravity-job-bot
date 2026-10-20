import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

async function scanRecentPriority() {
  console.log('🔍 Fetching top recent priority emails from Oct 1 & Oct 2...');
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com', pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const sinceDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const messages = client.fetch({ since: sinceDate }, { envelope: true, source: true });
    const emailList = [];

    for await (const msg of messages) {
      try {
        const parsed = await simpleParser(msg.source);
        const fromName = parsed.from?.value?.[0]?.name || '';
        const fromAddress = parsed.from?.value?.[0]?.address || '';
        const subject = parsed.subject || '(No Subject)';
        const date = parsed.date || msg.envelope?.date;
        const textSnippet = (parsed.text || '').replace(/\s+/g, ' ').slice(0, 400);

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

    // Sort descending (newest first)
    emailList.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // Filter out standard bank/delivery noise for clarity
    const isNoise = (e) => {
      const s = (e.subject + ' ' + e.from).toLowerCase();
      return /hdfc|swiggy|zomato|uber|dunzo|jio|airtel|cred|cred\.club|zepto|dunzo|netmeds|tata\s*play|electricity|upi\s*txn|budget\s*travel|taj\s*innercircle/.test(s);
    };

    const important = emailList.filter(e => !isNoise(e));
    console.log(`\n=== TOTAL RECENT IMPORTANT / JOB / RECRUITER EMAILS: ${important.length} ===\n`);

    important.slice(0, 35).forEach((e, idx) => {
      console.log(`[${idx + 1}] ${e.dateStr} | ${e.from}`);
      console.log(`    📌 Subject: ${e.subject}`);
      console.log(`    💬 Preview: ${e.snippet.slice(0, 200)}...`);
      console.log('----------------------------------------------------------------------');
    });

  } finally {
    lock.release();
    await client.logout();
  }
}

scanRecentPriority().catch(console.error);
