// email-feedback-collector.js
// Collector that reads feedback from an email inbox (IMAP)
// Pulls unread emails and converts them to feedback sections in ctx.passedFiles

const fs = require('fs');
const path = require('path');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    
    // Email config
    const imapHost = engineCfg.imapHost || process.env.EMAIL_IMAP_HOST;
    const imapPort = engineCfg.imapPort || process.env.EMAIL_IMAP_PORT || 993;
    const imapUser = engineCfg.imapUser || process.env.EMAIL_IMAP_USER;
    const imapPass = engineCfg.imapPass || process.env.EMAIL_IMAP_PASS;
    const imapSecure = engineCfg.imapSecure !== false; // default true
    const mailbox = engineCfg.mailbox || 'INBOX';
    const markAsRead = engineCfg.markAsRead !== false; // default true

    if (!imapHost || !imapUser || !imapPass) {
      console.error('❌ Email feedback collector: IMAP config incomplete. Set EMAIL_IMAP_HOST, EMAIL_IMAP_USER, EMAIL_IMAP_PASS in .env');
      return;
    }

    try {
      let Imap;
      try {
        Imap = require('imap');
      } catch {
        throw new Error('imap not installed. Run: npm install imap');
      }

      const imap = new Imap({
        user: imapUser,
        password: imapPass,
        host: imapHost,
        port: imapPort,
        tls: imapSecure,
      });

      console.log(`📧 Connecting to IMAP: ${imapHost}:${imapPort}...`);
      
      await new Promise((resolve, reject) => {
        imap.openBox(mailbox, false, (err, box) => {
          if (err) reject(err);
          else resolve(box);
        });
      });

      console.log(`✅ Connected to ${mailbox}. Searching for unread emails...`);

      // Search for unread emails
      const results = await new Promise((resolve, reject) => {
        imap.search(['UNSEEN'], (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      if (results.length === 0) {
        console.log('ℹ️  No unread feedback emails found.');
        imap.end();
        return;
      }

      console.log(`📨 Found ${results.length} unread email(s).`);

      // Fetch emails
      const f = imap.fetch(results, { bodies: '' });
      const emails = [];

      await new Promise((resolve, reject) => {
        f.on('message', (msg, seqno) => {
          let email = { from: '', subject: '', body: '', seqno };

          msg.on('body', (stream, info) => {
            stream.on('data', (chunk) => {
              email.rawBody = (email.rawBody || '') + chunk.toString('utf8');
            });
          });

          msg.on('attributes', (attrs) => {
            email.uid = attrs.uid;
          });

          msg.on('end', () => {
            emails.push(email);
          });
        });

        f.on('error', reject);
        f.on('end', resolve);
      });

      // Parse email headers
      const parsedEmails = emails.map(email => {
        const headerMatch = email.rawBody.match(/^([\s\S]*?)\r?\n\r?\n/);
        const headerText = headerMatch ? headerMatch[1] : '';
        
        const fromMatch = headerText.match(/^From:\s*(.*)$/m);
        const subjectMatch = headerText.match(/^Subject:\s*(.*)$/m);
        
        const bodyMatch = email.rawBody.match(/\r?\n\r?\n([\s\S]*)$/);
        const bodyText = bodyMatch ? bodyMatch[1].trim() : '';

        return {
          from: fromMatch ? fromMatch[1].trim() : 'Unknown',
          subject: subjectMatch ? subjectMatch[1].trim() : 'No Subject',
          body: bodyText,
          uid: email.uid,
          seqno: email.seqno,
        };
      });

      // Convert emails to feedback entries
      parsedEmails.forEach((email, idx) => {
        ctx.passedFiles.push({
          name: `Email Feedback #${idx + 1}`,
          type: 'user-feedback',
          prompt: `User response from: ${email.from}`,
          documents: [
            {
              filename: `feedback-${idx + 1}.md`,
              content: `**From:** ${email.from}\n**Subject:** ${email.subject}\n\n${email.body}`,
            }
          ],
        });
        console.log(`✅ Added feedback from ${email.from}: "${email.subject}"`);
      });

      // Mark emails as read if configured
      if (markAsRead && parsedEmails.length > 0) {
        const uids = parsedEmails.map(e => e.uid);
        await new Promise((resolve, reject) => {
          imap.addFlags(uids, ['\\Seen'], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log(`📖 Marked ${uids.length} email(s) as read.`);
      }

      imap.end();
    } catch (err) {
      console.error(`❌ Email feedback collector failed: ${err.message}`);
    }
  }
};
