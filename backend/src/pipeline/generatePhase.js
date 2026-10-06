const Contact = require('../models/Contact');
const OpenAIService = require('../services/openaiService');

/**
 * Generate email content for all Pending contacts.
 * @param {object} brand - mongoose Brand doc
 * @param {object} logger
 * @param {object} opts - { limit?: number }
 * @returns {{ generated: number, failed: number }}
 */
async function generatePhase(brand, logger, opts = {}) {
  logger.info('--- GENERATION PHASE ---');

  const limit = opts.limit || brand.campaign?.dailyLimit || 20;
  const contacts = await Contact.find({ brandId: brand._id, status: 'Pending' }).limit(limit);

  if (!contacts.length) {
    logger.info('No pending contacts to generate emails for');
    return { generated: 0, failed: 0 };
  }

  logger.info(`Generating emails for ${contacts.length} contacts...`);

  const openai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);
  let generated = 0;
  let failed = 0;

  const useAB = brand.abTest?.enabled && brand.abTest?.promptA && brand.abTest?.promptB;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    let systemPrompt = brand.openai?.systemPrompt || null;
    let abVariant = null;

    if (useAB) {
      abVariant = i % 2 === 0 ? 'A' : 'B';
      systemPrompt = abVariant === 'A' ? brand.abTest.promptA : brand.abTest.promptB;
    }

    let result;
    try {
      result = await openai.generateEmail(contact.toObject(), brand, systemPrompt);
    } catch (err) {
      if (err.code === 'QUOTA_EXCEEDED') {
        logger.error('[GEN] OpenAI quota exceeded — halting. Remaining contacts stay Pending.');
        break;
      }
      result = null;
    }

    if (result && result.subject && result.body) {
      await Contact.findByIdAndUpdate(contact._id, {
        status: 'Generated',
        emailSubject: result.subject,
        generatedEmailContent: result.body,
        abVariant
      });
      generated++;
      logger.info(`  Generated [${i + 1}/${contacts.length}]: ${contact.email} — "${result.subject}"`);
    } else {
      await Contact.findByIdAndUpdate(contact._id, {
        status: 'Failed',
        errorMessage: 'OpenAI email generation failed'
      });
      failed++;
      logger.warn(`  Failed to generate for: ${contact.email}`);
    }
  }

  logger.info(`Generation complete: ${generated} generated, ${failed} failed`);
  return { generated, failed };
}

module.exports = generatePhase;
