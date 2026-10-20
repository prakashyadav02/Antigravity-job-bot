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
    let latest = null;
    for await (const msg of messages) {
      if (msg.source) latest = msg;
    }

    if (latest) {
      const parsed = await simpleParser(latest.source);
      console.log('Subject:', parsed.subject);
      
      // Look for Date/Time lines in text or html
      const lines = (parsed.text || '').split('\n').map(l => l.trim()).filter(Boolean);
      console.log('Lines in email text:');
      lines.slice(0, 15).forEach(l => console.log('  >', l));

      if (parsed.html) {
        // extract time mentions
        const match = parsed.html.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[^<]*\d{1,2}:\d{2}[^<]*/i);
        if (match) console.log('HTML Date/Time match:', match[0]);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

main().catch(console.error);
