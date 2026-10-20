import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

async function readGauravEmail() {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com', pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    logger: false
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const messages = await client.search({ from: 'GauravG@ferfier.com' }, { uid: true });
    console.log(`Found ${messages.length} messages from Gaurav Giri.`);

    for (let i = 0; i < messages.length; i++) {
      const uid = messages[i];
      const msg = await client.fetchOne(uid, { source: true, envelope: true });
      const parsed = await simpleParser(msg.source);

      console.log(`\n================ MESSAGE #${i + 1} ================`);
      console.log('Date:', parsed.date);
      console.log('Subject:', parsed.subject);
      console.log('From:', parsed.from?.text);
      console.log('To:', parsed.to?.text);
      console.log('\n--- FULL TEXT BODY ---\n');
      console.log(parsed.text);
      console.log('--------------------------------------------------\n');
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

readGauravEmail().catch(console.error);
