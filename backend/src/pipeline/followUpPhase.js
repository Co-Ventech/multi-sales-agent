const Contact = require('../models/Contact');
const EmailLog = require('../models/EmailLog');
const OpenAIService = require('../services/openaiService');
const SmtpSender = require('../services/smtpSender');
const { getNextAccount, claimSendSlot } = require('../services/rotationService');
const { checkSpam } = require('../services/spamFilter');

/**
 * Follow-up phase: send follow-up emails to contacts who haven't replied.
 * @param {object} brand - mongoose Brand doc
 * @param {object} logger
 * @param {object} opts - { dryRun? }
 * @returns {{ sent: number }}
 */
async function followUpPhase(brand, logger, opts = {}) {
  logger.info('--- FOLLOW-UP PHASE ---');

  if (brand.campaign?.followUpsEnabled === false) {
    logger.info('Follow-ups are disabled for this brand (campaign.followUpsEnabled=false). Skipping.');
    return { sent: 0 };
  }

  const openai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);
  const followUpDays = brand.campaign?.followUpDays || [3];
  let totalSent = 0;

  // Only process as many follow-ups as days configured (default: 1)
  for (let i = 0; i < followUpDays.length; i++) {
    const followUpNum = i + 1;
    const days = followUpDays[i];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    logger.info(`FU${followUpNum}: Looking for contacts sent ${days}+ days ago with no reply...`);

    // Find contacts that:
    // 1. Were sent an initial email
    // 2. Haven't replied or bounced
    // 3. Were sent more than `days` days ago
    // 4. Don't already have this follow-up (followUps.length < followUpNum)
    const candidates = await Contact.find({
      brandId: brand._id,
      status: 'Sent',
      dateSent: { $lt: cutoff },
      dateReplied: null,
      dateBounced: null
    }).limit((brand.campaign?.dailyLimit || 20) * 2);

    // Filter to those that don't yet have follow-up #followUpNum
    const dueContacts = candidates.filter(c => {
      const fuCount = c.followUps ? c.followUps.length : 0;
      return fuCount < followUpNum;
    });

    if (!dueContacts.length) {
      logger.info(`FU${followUpNum}: No contacts due for day-${days} follow-up`);
      continue;
    }

    logger.info(`FU${followUpNum}: ${dueContacts.length} contacts due at day ${days}`);

    for (const contact of dueContacts) {
      // Generate follow-up email
      const gen = await openai.generateFollowUp(contact.toObject(), brand, followUpNum);
      if (!gen || !gen.subject || !gen.body) {
        logger.warn(`  FU${followUpNum} generation failed: ${contact.email}`);
        continue;
      }

      // Spam filter
      if (brand.campaign?.spamFilter) {
        const spam = checkSpam(gen.subject, gen.body);
        if (!spam.passed) {
          logger.warn(`[SPAM] FU${followUpNum} blocked: ${contact.email} — ${spam.matches.join(', ')}`);
          continue;
        }
      }

      if (opts.dryRun) {
        logger.info(`[DRY RUN] FU${followUpNum} would send to: ${contact.email}`);
        continue;
      }

      // Get available SMTP account
      const smtpAccount = await getNextAccount(brand._id);
      if (!smtpAccount) {
        logger.warn('All SMTP accounts exhausted for today — stopping follow-up phase');
        break;
      }

      const slotClaimed = await claimSendSlot(smtpAccount);
      if (!slotClaimed) {
        logger.warn(`Account ${smtpAccount.fromEmail} capacity reached`);
        continue;
      }

      const sender = new SmtpSender(smtpAccount, logger);
      const result = await sender.send(
        contact.email,
        gen.subject,
        gen.body,
        null, // no new tracking for follow-ups
        null,
        null,
        null
      );

      if (result.success) {
        const fuEntry = {
          num: followUpNum,
          subject: gen.subject,
          body: result.processedBody,
          sentAt: new Date(),
          smtpAccountId: smtpAccount._id
        };

        await Contact.findByIdAndUpdate(contact._id, {
          $push: { followUps: fuEntry }
        });

        await EmailLog.create({
          brandId: brand._id,
          contactId: contact._id,
          smtpAccountId: smtpAccount._id,
          type: `followup_${followUpNum}`,
          subject: gen.subject,
          body: result.processedBody,
          to: contact.email,
          from: smtpAccount.fromEmail,
          status: 'sent'
        });

        logger.info(`  FU${followUpNum} sent → ${contact.email} [via: ${smtpAccount.fromEmail}]`);
        totalSent++;
      } else {
        logger.warn(`  FU${followUpNum} failed → ${contact.email}: ${result.error}`);
      }

      // Random delay between sends
      await sender.randomDelay(
        (brand.campaign?.delayMinSec || 8) * 1000,
        (brand.campaign?.delayMaxSec || 20) * 1000
      );
    }
  }

  logger.info(`Follow-up phase complete: ${totalSent} follow-ups sent`);
  return { sent: totalSent };
}

module.exports = followUpPhase;
