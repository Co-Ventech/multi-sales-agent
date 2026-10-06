const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { decrypt } = require('../utils/crypto');

/**
 * Check IMAP inbox for bounces and replies using ImapFlow.
 * ImapFlow handles timeouts far more reliably than the `imap` package.
 */
async function checkInbox(smtpAccount, brand, knownEmailsMap, lookbackDays = 7, logger) {
  const password = decrypt(smtpAccount.passwordEncrypted);

  // Derive IMAP host from SMTP host
  let imapHost = smtpAccount.host;
  if (imapHost.toLowerCase().startsWith('smtp.')) {
    imapHost = 'imap.' + imapHost.slice(5);
  }

  const imapPort = (smtpAccount.useSSL || smtpAccount.useTLS) ? 993 : 143;

  const bounces = [];
  const replies = [];

  const client = new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: imapPort === 993,
    auth: { user: smtpAccount.username, pass: password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000
  });

  // Hard safety timeout — ImapFlow should handle it, but just in case
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('IMAP hard timeout (60s)')), 60000)
  );

  try {
    await Promise.race([_doCheck(client, knownEmailsMap, lookbackDays, bounces, replies, logger), timeout]);
  } catch (err) {
    if (logger) logger.warn(`IMAP check failed (${smtpAccount.username}): ${err.message}`);
    try { await client.logout(); } catch {}
  }

  return { bounces, replies };
}

async function _doCheck(client, knownEmailsMap, lookbackDays, bounces, replies, logger) {
  await client.connect();

  const since = new Date(Date.now() - lookbackDays * 86400000);

  await client.mailboxOpen('INBOX');

  // Search messages received since lookback date
  const uids = await client.search({ since });

  if (!uids || uids.length === 0) {
    await client.logout();
    return;
  }

  if (logger) logger.debug(`IMAP: found ${uids.length} messages to scan`);

  for await (const msg of client.fetch(uids, { source: true })) {
    try {
      const parsed = await simpleParser(msg.source);
      const fromAddr = (parsed.from?.text || '').toLowerCase();
      const subjectText = (parsed.subject || '').toLowerCase();
      const snippet = parsed.text ? parsed.text.slice(0, 500) : '';

      // Detect bounce
      const isBounce = (
        fromAddr.includes('mailer-daemon') ||
        fromAddr.includes('postmaster') ||
        fromAddr.includes('mail-daemon') ||
        fromAddr.includes('noreply@bounce') ||
        subjectText.includes('undeliverable') ||
        subjectText.includes('delivery failed') ||
        subjectText.includes('delivery failure') ||
        subjectText.includes('delivery status notification') ||
        subjectText.includes('returned mail') ||
        subjectText.includes('mail delivery failed') ||
        subjectText.includes('failure notice')
      );

      if (isBounce) {
        const bouncedEmail = _extractBouncedEmail(parsed.text || '', knownEmailsMap);
        if (bouncedEmail) {
          bounces.push({
            email: bouncedEmail,
            reason: subjectText || 'delivery failure',
            rawSnippet: snippet.slice(0, 300)
          });
        }
      } else {
        const replyFromEmail = _extractEmailAddress(fromAddr);
        if (replyFromEmail && knownEmailsMap.has(replyFromEmail.toLowerCase())) {
          const isAutoReply = (
            subjectText.includes('out of office') ||
            subjectText.includes('automatic reply') ||
            subjectText.includes('auto-reply') ||
            subjectText.includes('vacation') ||
            (parsed.headers?.get('x-auto-response-suppress')) ||
            (parsed.headers?.get('auto-submitted') === 'auto-replied')
          );

          if (!isAutoReply) {
            replies.push({
              email: replyFromEmail.toLowerCase(),
              snippet: snippet.slice(0, 500)
            });
          }
        }
      }
    } catch {
      // Skip unparseable messages
    }
  }

  await client.logout();
}

function _extractEmailAddress(fromText) {
  const match = fromText.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
  return match ? match[1] : null;
}

function _extractBouncedEmail(bodyText, knownEmailsMap) {
  const emailRegex = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
  let match;
  while ((match = emailRegex.exec(bodyText)) !== null) {
    const email = match[1].toLowerCase();
    if (knownEmailsMap.has(email)) return email;
  }
  return null;
}

module.exports = { checkInbox };
