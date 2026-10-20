import { ImapFlow } from 'imapflow';
import 'dotenv/config';

async function main() {
  const email = process.env.GMAIL_USER || 'vivekchaudhary538@gmail.com';
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass },
    logger: false
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messages = await client.search({
        from: 'instahyre.com'
      }, { uid: true });

      console.log(`Found ${messages.length} messages from instahyre.com`);

      const recentUids = messages.slice(-5);
      for (const uid of recentUids) {
        const msg = await client.fetchOne(uid, { envelope: true });
        console.log(`- Subject: ${msg.envelope?.subject} | Date: ${msg.envelope?.date}`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main().catch(console.error);
