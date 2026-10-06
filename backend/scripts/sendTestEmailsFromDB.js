/**
 * sendTestEmailsFromDB.js
 * Fetches brand prompts from DB, generates emails via OpenAI, sends to test address.
 * Usage: node scripts/sendTestEmailsFromDB.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');
const SmtpAccount = require('../src/models/SmtpAccount');
const OpenAIService = require('../src/services/openaiService');
const SmtpSender = require('../src/services/smtpSender');

const TEST_EMAIL = 'm.muzammil.bhashani@gmail.com';
const BRAND_SLUG = 'co-ventech';

// Fake contact for test — use snake_case to match buildEmailPrompt field names
const testContact = {
  first_name: 'Muzammil',
  last_name: 'Bhashani',
  email: TEST_EMAIL,
  job_title: 'CTO',
  company_name: 'TestCorp',
  industry: 'Technology',
  city: 'Karachi',
  country: 'Pakistan',
  company_size: '50-200',
  headline: 'Building innovative SaaS products for the logistics sector',
  company_description: 'TestCorp builds scalable SaaS products used by logistics and supply-chain companies across South Asia.'
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) {
    console.error(`Brand "${BRAND_SLUG}" not found`);
    process.exit(1);
  }

  console.log(`\nBrand: ${brand.name}`);
  console.log(`A/B Test enabled: ${brand.abTest?.enabled}`);
  console.log(`\n--- Prompt A (${(brand.abTest?.promptA || '').slice(0, 80)}...) ---`);
  console.log(brand.abTest?.promptA || '(not set)');
  console.log(`\n--- Prompt B (${(brand.abTest?.promptB || '').slice(0, 80)}...) ---`);
  console.log(brand.abTest?.promptB || '(not set)');

  const accounts = await SmtpAccount.find({ brandId: brand._id, isActive: true });
  if (accounts.length < 1) {
    console.error('No active SMTP accounts found');
    process.exit(1);
  }

  const ai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);

  const variants = [
    { label: 'A', prompt: brand.abTest?.promptA, account: accounts[0] },
    { label: 'B', prompt: brand.abTest?.promptB, account: accounts[1] || accounts[0] }
  ];

  for (const v of variants) {
    if (!v.prompt) {
      console.log(`\nSkipping Variant ${v.label} — no prompt configured`);
      continue;
    }

    console.log(`\n========== Variant ${v.label} ==========`);
    console.log(`Sending from: ${v.account.fromEmail} (${v.account.username})`);
    console.log(`Generating email via OpenAI...`);

    const generated = await ai.generateEmail(testContact, brand, v.prompt);
    if (!generated) {
      console.error(`OpenAI generation failed for Variant ${v.label}`);
      continue;
    }

    console.log(`Subject: ${generated.subject}`);
    console.log(`Body preview: ${generated.body.slice(0, 120)}...`);

    const trackingUid = require('crypto').randomBytes(8).toString('hex');
    const sender = new SmtpSender(v.account, { info: console.log, debug: console.log });

    const result = await sender.send(
      TEST_EMAIL,
      `[Variant ${v.label}] ${generated.subject}`,
      generated.body,
      trackingUid,
      brand.campaign?.calendlyUrl,
      brand.slug,
      v.label
    );

    if (result.success) {
      console.log(`✅ Sent! MessageId: ${result.messageId}`);
      console.log(`Tracking link: ${process.env.SERVER_URL}/c/${trackingUid}`);
    } else {
      console.error(`❌ Failed: ${result.error}`);
    }
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
