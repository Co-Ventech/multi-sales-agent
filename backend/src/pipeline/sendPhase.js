const Contact = require('../models/Contact');
const EmailLog = require('../models/EmailLog');
const OpenAIService = require('../services/openaiService');
const SmtpSender = require('../services/smtpSender');
const { getNextAccount, claimSendSlot } = require('../services/rotationService');
const { checkSpam } = require('../services/spamFilter');
const { filterByBusinessHours } = require('../utils/timezoneScheduler');

/**
 * Send phase: generate (if needed) and send emails to qualified contacts.
 * @param {object} brand - mongoose Brand doc
 * @param {object} logger
 * @param {object} opts - { limit?, dryRun? }
 * @returns {{ sent: number, failed: number, spamBlocked: number }}
 */
async function sendPhase(brand, logger, opts = {}) {
  logger.info('--- SEND PHASE ---');

  const limit = opts.limit || brand.campaign?.dailyLimit || 20;
  const isDryRun = opts.dryRun || false;

  if (isDryRun) {
    logger.info('[DRY RUN] No emails will be sent');
  }

  // Build set of paused ImportBatch IDs to exclude — users can pause sending per upload file
  const ImportBatch = require('../models/ImportBatch');
  const pausedBatches = await ImportBatch.find({ brandId: brand._id, paused: true }).select('_id');
  const pausedIds = pausedBatches.map(b => b._id);
  if (pausedIds.length > 0) {
    logger.info(`${pausedIds.length} import batch(es) paused — their contacts will be skipped`);
  }

  // Fetch contacts ready to send — fetch more than needed to account for timezone filter
  const allContacts = await Contact.find({
    brandId: brand._id,
    status: { $in: ['Pending', 'Generated'] },
    ...(pausedIds.length ? { $or: [
      { importBatchId: { $exists: false } },
      { importBatchId: null },
      { importBatchId: { $nin: pausedIds } }
    ] } : {})
  }).limit(limit * 4);

  if (!allContacts.length) {
    logger.info('No contacts ready to send');
    return { sent: 0, failed: 0, spamBlocked: 0 };
  }

  logger.info(`Found ${allContacts.length} contacts eligible for sending`);

  // Apply timezone filter if enabled
  let contacts;
  if (brand.campaign?.timezoneFilter) {
    const filtered = filterByBusinessHours(
      allContacts.map(c => ({ ...c.toObject(), _id: c._id })),
      logger
    );
    contacts = filtered.slice(0, limit);
  } else {
    contacts = allContacts.slice(0, limit);
  }

  if (!contacts.length) {
    logger.info('No contacts in business hours right now (timezone filter active)');
    return { sent: 0, failed: 0, spamBlocked: 0 };
  }

  logger.info(`Processing ${contacts.length} contacts for send...`);

  const openai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);
  let sent = 0;
  let failed = 0;
  let spamBlocked = 0;

  // A/B test setup
  const useAB = brand.abTest?.enabled && brand.abTest?.promptA && brand.abTest?.promptB;
  let abIndex = 0;

  for (const contactData of contacts) {
    // Reload contact to get latest state
    const contact = await Contact.findById(contactData._id || contactData.id);
    if (!contact) continue;

    // Skip if already sent/bounced/replied during this batch
    if (!['Pending', 'Generated'].includes(contact.status)) continue;

    // Generate email content if not already generated
    if (!contact.generatedEmailContent) {
      let systemPrompt = brand.openai?.systemPrompt || null;
      let variant = null;

      if (useAB) {
        variant = abIndex % 2 === 0 ? 'A' : 'B';
        systemPrompt = variant === 'A' ? brand.abTest.promptA : brand.abTest.promptB;
        abIndex++;
      }

      let gen;
      try {
        gen = await openai.generateEmail(contact.toObject(), brand, systemPrompt);
      } catch (err) {
        if (err.code === 'QUOTA_EXCEEDED') {
          // OpenAI quota exhausted — stop the send phase entirely.
          // Leave contact as Pending (no DB write) so it retries automatically next run.
          logger.error('[SEND] OpenAI quota exceeded — halting send phase. Contacts remain Pending.');
          break;
        }
        gen = null;
      }
      if (!gen || !gen.subject || !gen.body) {
        await Contact.findByIdAndUpdate(contact._id, {
          status: 'Failed',
          errorMessage: 'Email generation failed during send phase'
        });
        failed++;
        logger.warn(`  Generation failed: ${contact.email}`);
        continue;
      }

      contact.generatedEmailContent = gen.body;
      contact.emailSubject = gen.subject;
      contact.abVariant = variant;

      await Contact.findByIdAndUpdate(contact._id, {
        generatedEmailContent: gen.body,
        emailSubject: gen.subject,
        abVariant: variant,
        status: 'Generated'
      });
    } else if (useAB && !contact.abVariant) {
      // Assign A/B variant to already-generated contact
      const variant = abIndex % 2 === 0 ? 'A' : 'B';
      await Contact.findByIdAndUpdate(contact._id, { abVariant: variant });
      contact.abVariant = variant;
      abIndex++;
    }

    // Spam filter check
    if (brand.campaign?.spamFilter) {
      const spam = checkSpam(contact.emailSubject || '', contact.generatedEmailContent || '');
      if (!spam.passed) {
        logger.warn(`[SPAM] Blocked: ${contact.email} — triggers: ${spam.matches.join(', ')}`);
        await Contact.findByIdAndUpdate(contact._id, {
          status: 'SpamBlocked',
          errorMessage: `Spam triggers: ${spam.matches.slice(0, 3).join(', ')}`
        });
        spamBlocked++;
        continue;
      }
    }

    // Dry run — mark and continue
    if (isDryRun) {
      logger.info(`[DRY RUN] Would send to ${contact.email}: "${contact.emailSubject}"`);
      await Contact.findByIdAndUpdate(contact._id, { status: 'DryRun' });
      sent++;
      continue;
    }

    // Get next available SMTP account with remaining capacity
    const smtpAccount = await getNextAccount(brand._id);
    if (!smtpAccount) {
      logger.warn('All SMTP accounts exhausted for today — stopping send phase');
      break;
    }

    // Atomically claim send slot
    const slotClaimed = await claimSendSlot(smtpAccount);
    if (!slotClaimed) {
      logger.warn(`Account ${smtpAccount.fromEmail} capacity reached, trying next...`);
      // Try next contact iteration — getNextAccount will pick a different one
      continue;
    }

    // Update contact with SMTP account info before sending
    await Contact.findByIdAndUpdate(contact._id, {
      smtpAccountId: smtpAccount._id,
      sentFrom: smtpAccount.fromEmail
    });

    // Send the email
    const sender = new SmtpSender(smtpAccount, logger);
    const result = await sender.send(
      contact.email,
      contact.emailSubject,
      contact.generatedEmailContent
    );

    if (result.success) {
      await Contact.findByIdAndUpdate(contact._id, {
        status: 'Sent',
        dateSent: new Date(),
        generatedEmailContent: result.processedBody,
        smtpAccountId: smtpAccount._id,
        sentFrom: smtpAccount.fromEmail,
        errorMessage: null
      });

      await EmailLog.create({
        brandId: brand._id,
        contactId: contact._id,
        smtpAccountId: smtpAccount._id,
        type: 'initial',
        abVariant: contact.abVariant,
        subject: contact.emailSubject,
        body: result.processedBody,
        to: contact.email,
        from: smtpAccount.fromEmail,
        status: 'sent',
        messageId: result.messageId
      });

      logger.info(`  Sent → ${contact.email} [via: ${smtpAccount.fromEmail}] [variant: ${contact.abVariant || 'none'}]`);
      sent++;
    } else {
      await Contact.findByIdAndUpdate(contact._id, {
        status: 'Failed',
        errorMessage: result.error,
        $inc: { retryAttempts: 1 }
      });

      await EmailLog.create({
        brandId: brand._id,
        contactId: contact._id,
        smtpAccountId: smtpAccount._id,
        type: 'initial',
        subject: contact.emailSubject,
        to: contact.email,
        from: smtpAccount.fromEmail,
        status: 'failed',
        errorMessage: result.error
      });

      logger.warn(`  Failed → ${contact.email}: ${result.error}`);
      failed++;
    }

    // Random delay between sends — default ~1 minute (50–90s) for natural pacing.
    // Configurable per brand via campaign.delayMinSec / delayMaxSec.
    await sender.randomDelay(
      (brand.campaign?.delayMinSec ?? 50) * 1000,
      (brand.campaign?.delayMaxSec ?? 90) * 1000
    );
  }

  logger.info(`Send phase complete: ${sent} sent, ${failed} failed, ${spamBlocked} spam blocked`);
  return { sent, failed, spamBlocked };
}

module.exports = sendPhase;
