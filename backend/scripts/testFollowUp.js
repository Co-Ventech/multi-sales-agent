/**
 * testFollowUp.js — Send a test follow-up email to your own address.
 * Usage: node scripts/testFollowUp.js [followUpNumber]
 *   followUpNumber: 1 (day 3), 2 (day 7), or 3 (day 14 breakup) — default: 1
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');
const SmtpAccount = require('../src/models/SmtpAccount');
const OpenAIService = require('../src/services/openaiService');
const SmtpSender = require('../src/services/smtpSender');

const BRAND_SLUG = 'co-ventech';
const TEST_TO = 'm.muzammil.bhashani@gmail.com';
const FOLLOW_UP_NUM = parseInt(process.argv[2] || '1', 10);

// Simulate a contact that received an initial email
const fakeContact = {
  firstName: 'Muzammil',
  first_name: 'Muzammil',
  lastName: 'Bhashani',
  last_name: 'Bhashani',
  email: TEST_TO,
  jobTitle: 'CTO',
  job_title: 'CTO',
  companyName: 'TestCorp',
  company_name: 'TestCorp',
  industry: 'SaaS',
  companyDescription: 'A SaaS platform for logistics automation.',
  company_description: 'A SaaS platform for logistics automation.',
  companySize: '50',
  company_size: '50',
  country: 'United States',
  emailSubject: 'Accelerate Your IT Operations with Proven Results',  // original subject
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB\n`);

  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) { console.error('Brand not found'); process.exit(1); }

  const accounts = await SmtpAccount.find({ brandId: brand._id, isActive: true });
  if (!accounts.length) { console.error('No SMTP accounts'); process.exit(1); }

  const account = accounts[0]; // Use first account (Zubair)
  const ai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);

  console.log(`Sending follow-up #${FOLLOW_UP_NUM} to ${TEST_TO}`);
  console.log(`From: ${account.fromEmail}\n`);

  const gen = await ai.generateFollowUp(fakeContact, brand, FOLLOW_UP_NUM);
  if (!gen) { console.error('OpenAI generation failed'); process.exit(1); }

  console.log(`Subject: ${gen.subject}`);
  console.log(`\nBody:\n${gen.body}\n`);

  const sender = new SmtpSender(account, { info: console.log, debug: () => {}, warn: console.warn, error: console.error });
  const result = await sender.send(
    TEST_TO,
    gen.subject,
    gen.body,
    null,
    brand.campaign?.calendlyUrl,
    brand.slug,
    null
  );

  if (result.success) {
    console.log(`\n✅ Follow-up #${FOLLOW_UP_NUM} sent! MessageId: ${result.messageId}`);
  } else {
    console.error(`\n❌ Failed: ${result.error}`);
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
