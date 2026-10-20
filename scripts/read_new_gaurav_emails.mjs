import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

async function main() {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
    logger: false
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const messages = client.fetch({ from: 'GauravG@ferfier.com' }, { envelope: true, source: true });
    const list = [];
    for await (const msg of messages) {
      if (msg.source) {
        const parsed = await simpleParser(msg.source);
        list.push({
          date: parsed.date,
          subject: parsed.subject,
          text: parsed.text || '',
          html: parsed.html || ''
        });
      }
    }

    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    console.log(`\n=== LAST 2 EMAILS FROM GAURAV GIRI ===\n`);
    for (let i = 0; i < Math.min(list.length, 2); i++) {
      console.log(`[Email #${i + 1}] Date: ${list[i].date}`);
      console.log(`Subject: ${list[i].subject}`);
      console.log(`Body:\n${list[i].text.slice(0, 1500)}`);
      console.log('---------------------------------------------------\n');
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch(console.error);
