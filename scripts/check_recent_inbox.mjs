import 'dotenv/config';
import { ImapFlow } from 'imapflow';

async function checkRecent() {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
    logger: false
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const sinceDate = new Date(Date.now() - 4 * 60 * 60 * 1000); // Last 4 hours
    const messages = client.fetch({ since: sinceDate }, { envelope: true });
    const list = [];
    for await (const msg of messages) {
      list.push({
        date: msg.envelope?.date,
        from: (msg.envelope?.from?.[0]?.name || '') + ' <' + (msg.envelope?.from?.[0]?.address || '') + '>',
        subject: msg.envelope?.subject || ''
      });
    }
    console.log('Incoming emails in last 4 hours:', list.length);
    list.forEach(m => {
      console.log(`[${new Date(m.date).toLocaleTimeString('en-IN')}] From: ${m.from} | Subject: ${m.subject}`);
    });
  } finally {
    lock.release();
    await client.logout();
  }
}
checkRecent().catch(console.error);
