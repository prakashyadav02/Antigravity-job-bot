import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
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
      const messages = await client.search({ from: 'instahyre.com' }, { uid: true });
      console.log(`Total Instahyre messages: ${messages.length}`);

      if (messages.length > 0) {
        const lastUid = messages[messages.length - 1];
        const raw = await client.download(lastUid);
        const parsed = await simpleParser(raw.content);
        console.log('Latest Instahyre Email:');
        console.log('Subject:', parsed.subject);
        console.log('Date:', parsed.date);
        console.log('From:', parsed.from?.text);
        console.log('Snippet:', parsed.text?.slice(0, 300).replace(/\s+/g, ' '));
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
