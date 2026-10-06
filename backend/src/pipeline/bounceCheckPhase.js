const Contact = require('../models/Contact');
const BounceEmail = require('../models/BounceEmail');
const SmtpAccount = require('../models/SmtpAccount');
const { notifyReply, notifyBounce } = require('../services/slackNotifier');
const imapChecker = require('../services/imapChecker');

/**
 * Bounce check phase: scan IMAP inboxes for bounces and replies.
 * @param {object} brand - mongoose Brand doc
 * @param {object} logger
 * @param {object} opts - { lookbackDays? }
 * @returns {{ bounces: number, replies: number }}
 */
async function bounceCheckPhase(brand, logger, opts = {}) {
  logger.info('--- BOUNCE / REPLY CHECK ---');

  const accounts = await SmtpAccount.find({ brandId: brand._id, isActive: true });
  if (!accounts.length) {
    logger.warn('No active SMTP accounts configured for this brand');
    return { bounces: 0, replies: 0 };
  }

  // Build map of all sent-contact emails for this brand
  const contacts = await Contact.find({
    brandId: brand._id,
    status: { $in: ['Sent', 'Failed', 'Replied', 'Bounced'] }
  });

  const knownEmailsMap = new Map();
  contacts.forEach(c => {
    if (c.email) {
      knownEmailsMap.set(c.email.toLowerCase(), c);
    }
  });

  logger.info(`Checking ${accounts.length} inbox(es) for ${knownEmailsMap.size} known contact emails...`);

  if (knownEmailsMap.size === 0) {
    logger.info('No sent contacts to check — skipping IMAP scan');
    return { bounces: 0, replies: 0 };
  }

  const lookbackDays = opts.lookbackDays || 7;
  let totalBounces = 0;
  let totalReplies = 0;

  for (const account of accounts) {
    logger.info(`Checking inbox: ${account.username} (${account.host})`);

    try {
      const { bounces, replies } = await imapChecker.checkInbox(
        account,
        brand,
        knownEmailsMap,
        lookbackDays,
        logger
      );

      // Process bounces
      for (const bounce of bounces) {
        const contact = knownEmailsMap.get(bounce.email.toLowerCase());
        if (!contact) continue;

        // Skip if already marked as bounced
        if (contact.status === 'Bounced') continue;

        await Contact.findByIdAndUpdate(contact._id, {
          status: 'Bounced',
          dateBounced: new Date(),
          bounceReason: bounce.reason || 'delivery failure'
        });

        await BounceEmail.create({
          brandId: brand._id,
          smtpAccountId: account._id,
          contactEmail: bounce.email,
          contactId: contact._id,
          type: 'bounce',
          rawSnippet: bounce.rawSnippet || '',
          receivedAt: new Date(),
          processed: true
        });

        await notifyBounce(brand, contact, bounce.reason, accounts);
        totalBounces++;
        logger.info(`  Bounce: ${bounce.email} — ${bounce.reason || 'delivery failure'}`);
      }

      // Process replies
      for (const reply of replies) {
        const contact = knownEmailsMap.get(reply.email.toLowerCase());
        if (!contact) continue;

        // Skip if already marked as replied or bounced
        if (contact.status === 'Replied' || contact.status === 'Bounced') continue;

        await Contact.findByIdAndUpdate(contact._id, {
          status: 'Replied',
          dateReplied: new Date(),
          replyContent: reply.snippet
        });

        await BounceEmail.create({
          brandId: brand._id,
          smtpAccountId: account._id,
          contactEmail: reply.email,
          contactId: contact._id,
          type: 'reply',
          rawSnippet: reply.snippet || '',
          receivedAt: new Date(),
          processed: true
        });

        await notifyReply(brand, contact, reply.snippet, accounts);
        totalReplies++;
        logger.info(`  Reply: ${reply.email} — "${(reply.snippet || '').slice(0, 60)}..."`);
      }

    } catch (err) {
      logger.error(`IMAP error (${account.username}): ${err.message}`);
    }
  }

  logger.info(`Bounce check complete: ${totalBounces} bounces, ${totalReplies} replies`);
  return { bounces: totalBounces, replies: totalReplies };
}

module.exports = bounceCheckPhase;
