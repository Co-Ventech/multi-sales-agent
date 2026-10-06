const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { decrypt } = require('../utils/crypto');

class SmtpSender {
  constructor(smtpAccount, logger) {
    this.account = smtpAccount;
    this.logger = logger;

    const password = decrypt(smtpAccount.passwordEncrypted);
    this.password = password;

    const port = smtpAccount.port || 587;
    this.transporter = nodemailer.createTransport({
      host: smtpAccount.host,
      port,
      secure: smtpAccount.useSSL || false,  // true only if SSL explicitly set (port 465)
      auth: { user: smtpAccount.username, pass: password },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000
    });
  }

  async send(toEmail, subject, body) {
    try {
      const acct = this.account;

      // Strip placeholders. Strip URLs except whitelisted domains (Calendly).
      // Calendly is a trusted scheduling domain — preserving it actually lifts
      // reply rates and Gmail does NOT penalize Calendly URLs in cold email.
      const URL_WHITELIST = /^(?:[\w-]+\.)?(?:calendly\.com)\//i;
      let processedBody = body
        .replace(/\[Your Name\]/gi, acct.senderName || acct.fromName || '')
        .replace(/\[Your Position\]/gi, acct.senderPosition || '')
        .replace(/\[Your Phone\]/gi, '')
        .replace(/\[Your Website\]/gi, '')
        .replace(/https?:\/\/(\S+)/gi, (match, rest) => URL_WHITELIST.test(rest) ? match : '')
        // Em/en-dashes are an AI fingerprint — humans rarely type them.
        // Replace " — " and " – " with " - " to look human-typed.
        .replace(/\s+[—–]\s+/g, ' - ')
        .replace(/[—–]/g, '-')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Ensure blank lines between paragraphs — if lines are separated only by \n
      // (no blank line), upgrade to \n\n so email clients render proper spacing
      processedBody = processedBody
        .split('\n')
        .map(l => l.trimEnd())
        .join('\n')
        .replace(/([^\n])\n([^\n])/g, '$1\n\n$2');

      const senderName = acct.senderName || acct.fromName || '';
      const senderTitle = acct.senderPosition || '';

      // Plain text alternative (kept for any text-only client)
      const signature = [senderName, senderTitle].filter(Boolean).join('\n');
      const finalText = signature
        ? `${processedBody}\n\n${signature}`
        : processedBody;

      // Build HTML with a unique invisible marker so MailChannels' content
      // fingerprint differs per send (avoids the "same hash across all sends"
      // pattern that triggers bulk-mail spam scoring).
      const uniqueId = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
      const htmlBody = this._buildWebmailHtml(processedBody, senderName, senderTitle, uniqueId);

      // Message-ID must use the sender's domain. Nodemailer's default uses the
      // server hostname which Gmail flags as suspicious when it doesn't match From.
      const fromDomain = (acct.fromEmail || '').split('@')[1] || 'localhost';
      const msgIdNumeric = `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
      const messageId = `<${msgIdNumeric}.${Date.now()}@${fromDomain}>`;

      // Quoted, full sender name in From — matches webmail "Zubair Alam" format
      const fromName = (acct.fromName || senderName || '').trim();
      const fromHeader = fromName
        ? `"${fromName}" <${acct.fromEmail}>`
        : acct.fromEmail;

      // Send single-part text/html (NOT multipart/alternative). Matches what
      // Hostinger webmail produces — avoids the nodemailer "_NmP-" boundary
      // signature in multipart/alternative emails which MailChannels uses to
      // fingerprint automated sends.
      // We also add unique headers per email so content fingerprints differ.
      const mailOptions = {
        from: fromHeader,
        sender: acct.fromEmail,
        envelope: { from: acct.fromEmail, to: toEmail },
        to: toEmail,
        subject,
        // text: finalText,  ← intentionally omitted to force single-part HTML
        html: htmlBody,
        messageId,
        encoding: 'quoted-printable',
        headers: {
          'X-Entity-Ref-ID': uniqueId
        }
      };

      if (acct.replyTo) {
        mailOptions.replyTo = acct.replyTo;
      }

      const info = await this.transporter.sendMail(mailOptions);

      // Save to Sent folder via IMAP (non-blocking).
      // SKIP for Gmail/Google Workspace — Gmail SMTP automatically saves a copy
      // to the Sent folder, so an IMAP append would create a duplicate.
      const isGmail = /(?:^|\.)gmail\.com$|(?:^|\.)googlemail\.com$/i.test(acct.host || '');
      if (!isGmail) {
        this._saveToSentFolder(finalText, subject, toEmail, acct).catch(err => {
          if (this.logger && this.logger.debug) {
            this.logger.debug(`Could not save to Sent folder: ${err.message}`);
          }
        });
      }

      return {
        success: true,
        messageId: info.messageId,
        processedBody: finalText,
        error: null
      };
    } catch (err) {
      return {
        success: false,
        messageId: null,
        processedBody: body,
        error: err.message
      };
    }
  }

  async _saveToSentFolder(text, subject, toEmail, acct) {
    // Derive IMAP host: replace smtp. with imap.
    const imapHost = acct.host.replace(/^smtp\./i, 'imap.');
    // Use 993 (SSL) when STARTTLS or explicit SSL — most providers require this
    const imapPort = (acct.useSSL || acct.useTLS) ? 993 : 143;
    const imapSecure = imapPort === 993;

    const client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: imapSecure,
      auth: { user: acct.username, pass: this.password },
      logger: false,
      connectionTimeout: 8000
    });

    await client.connect();

    // Build raw RFC 2822 message
    const date = new Date().toUTCString();
    const rawMessage = [
      `From: ${acct.fromName || ''} <${acct.fromEmail}>`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      text
    ].join('\r\n');

    // Try common Sent folder names
    const sentFolders = ['Sent', 'Sent Items', 'Sent Messages', '[Gmail]/Sent Mail', 'INBOX.Sent'];
    for (const folder of sentFolders) {
      try {
        await client.append(folder, Buffer.from(rawMessage), ['\\Seen']);
        break;
      } catch {
        // Try next folder name
      }
    }

    await client.logout();
  }

  _buildWebmailHtml(bodyText, senderName, senderTitle, uniqueId = '') {
    const escape = s => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const escapedBody = escape(bodyText);

    const sigLines = [];
    if (senderName) sigLines.push(`<div>${escape(senderName)}</div>`);
    if (senderTitle) sigLines.push(`<div>${escape(senderTitle)}</div>`);
    const sigBlock = sigLines.length
      ? `<div><br></div><div class="hmail-signature-prefix">--</div><div class="hmail-signature"><div>${sigLines.join('')}</div></div><div><br></div>`
      : '';

    // Rotate font stack between webmail-typical options so consecutive sends
    // don't all hash to the same fingerprint at MailChannels.
    const fontStacks = [
      `Arial, Helvetica, sans-serif`,
      `&quot;Helvetica Neue&quot;, Arial, sans-serif`,
      `Verdana, Geneva, sans-serif`,
      `&quot;Segoe UI&quot;, Tahoma, sans-serif`
    ];
    const font = fontStacks[Math.floor(Math.random() * fontStacks.length)];

    // Invisible per-email marker (HTML comment) — invisible to recipients but
    // changes the body byte-for-byte every send, breaking the bulk-content hash.
    const invisibleMarker = uniqueId ? `<!-- ${uniqueId} -->` : '';

    return `${invisibleMarker}<div><span style="font-family:${font}"><span style="font-size:14px;white-space:pre-wrap">${escapedBody}</span></span></div>${sigBlock}`;
  }

  async verify() {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  async randomDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise(r => setTimeout(r, delay));
  }
}

module.exports = SmtpSender;
