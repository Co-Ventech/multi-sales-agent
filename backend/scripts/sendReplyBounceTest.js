/**
 * sendReplyBounceTest.js
 * Sends two real emails and saves them as Sent contacts in DB:
 *   1. m.muzammil.bhashani@gmail.com — reply to this to test reply detection
 *   2. bounce-test-invalid@no-such-domain-xyz123.com — will hard-bounce to test bounce detection
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const crypto = require('crypto');
const Brand = require('../src/models/Brand');
const SmtpAccount = require('../src/models/SmtpAccount');
const Contact = require('../src/models/Contact');
const OpenAIService = require('../src/services/openaiService');
const SmtpSender = require('../src/services/smtpSender');

const BRAND_SLUG = 'co-ventech';

const testContacts = [
  {
    first_name: 'Muzammil',
    last_name: 'Bhashani',
    email: 'm.muzammil.bhashani@gmail.com',
    job_title: 'CTO',
    company_name: 'TestCorp',
    industry: 'Technology',
    company_description: 'A SaaS company building logistics software.',
    variantHint: 'A'   // send via Zubair (account[0])
  },
  {
    first_name: 'Test',
    last_name: 'Bounce',
    email: 'bounce-test-invalid@no-such-domain-xyz123.com',
    job_title: 'CTO',
    company_name: 'BounceTest Inc',
    industry: 'SaaS',
    company_description: 'A software company.',
    variantHint: 'B'   // send via Sophie (account[1])
  }
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) { console.error('Brand not found'); process.exit(1); }

  const accounts = await SmtpAccount.find({ brandId: brand._id, isActive: true });
  if (!accounts.length) { console.error('No SMTP accounts'); process.exit(1); }

  const ai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);

  for (const tc of testContacts) {
    const acctIndex = tc.variantHint === 'A' ? 0 : Math.min(1, accounts.length - 1);
    const account = accounts[acctIndex];
    const prompt = tc.variantHint === 'A' ? brand.abTest?.promptA : brand.abTest?.promptB;

    console.log(`\n=== Sending to ${tc.email} (Variant ${tc.variantHint}) ===`);
    console.log(`From: ${account.fromEmail}`);

    // Generate email
    const generated = await ai.generateEmail(tc, brand, prompt);
    if (!generated) { console.error('OpenAI failed'); continue; }
    console.log(`Subject: ${generated.subject}`);

    // Send email
    const trackingUid = crypto.randomBytes(8).toString('hex');
    const sender = new SmtpSender(account, { info: console.log, debug: () => {} });
    const result = await sender.send(
      tc.email,
      generated.subject,
      generated.body,
      trackingUid,
      brand.campaign?.calendlyUrl,
      brand.slug,
      tc.variantHint
    );

    if (!result.success) {
      console.error(`SMTP failed: ${result.error}`);
      continue;
    }
    console.log(`Sent! MessageId: ${result.messageId}`);

    // Save as Sent contact in DB so bounce/reply checker can find it
    const existing = await Contact.findOne({ brandId: brand._id, email: tc.email });
    if (existing) {
      await Contact.findByIdAndUpdate(existing._id, {
        status: 'Sent',
        dateSent: new Date(),
        sentFrom: account.fromEmail,
        abVariant: tc.variantHint,
        emailSubject: generated.subject,
        generatedEmailContent: result.processedBody,
        trackingUid
      });
      console.log(`Updated existing contact → Sent`);
    } else {
      await Contact.create({
        brandId: brand._id,
        firstName: tc.first_name,
        lastName: tc.last_name,
        email: tc.email,
        jobTitle: tc.job_title,
        companyName: tc.company_name,
        industry: tc.industry,
        status: 'Sent',
        dateSent: new Date(),
        sentFrom: account.fromEmail,
        abVariant: tc.variantHint,
        emailSubject: generated.subject,
        generatedEmailContent: result.processedBody,
        trackingUid
      });
      console.log(`Created new contact → Sent`);
    }
  }

  console.log('\n✅ Done. Now:');
  console.log('  1. Reply to the email you received at m.muzammil.bhashani@gmail.com');
  console.log('  2. Wait ~5 min for the bounce to arrive at the sender inbox');
  console.log('  3. Run "Check Bounces" in the Pipeline — it should detect both');

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
