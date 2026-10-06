/**
 * Configure Leads-Gulf like Co-Ventech (same Apify actor + full filter),
 * Gulf-only contact_location / contact_city.
 *
 * Usage: node scripts/setupLeadsGulfBrand.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');
const { getLeadsGulfDefaultInput, LEADS_GULF_TEST_FETCH_COUNT } = require('../src/config/apifyLeadsFilters');

const LEADS_GULF_BRAND_ID = process.env.LEADS_GULF_BRAND_ID || '6a1429ab710919e24bc2e827';
const SOURCE_BRAND_NAME = 'Co-Ventech';

function copyBrandSettings(source, target) {
  if (source.openai) {
    target.openai = {
      systemPrompt: source.openai.systemPrompt,
      model: source.openai.model || 'gpt-4o',
      temperature: source.openai.temperature ?? 0.75,
      maxTokens: source.openai.maxTokens ?? 400
    };
  }

  if (source.abTest) {
    target.abTest = {
      enabled: source.abTest.enabled ?? false,
      promptA: source.abTest.promptA,
      promptB: source.abTest.promptB
    };
  }

  if (source.campaign) {
    target.campaign = { ...source.campaign.toObject?.() || source.campaign };
  }

  if (source.qualification) {
    target.qualification = { ...source.qualification.toObject?.() || source.qualification };
  }

  if (source.notifications) {
    target.notifications = { ...source.notifications };
  }

  if (source.slack) {
    target.slack = { ...source.slack.toObject?.() || source.slack };
  }

  target.googleSheets = target.googleSheets || { enabled: false };
  target.cron = {
    timezone: 'Asia/Dubai',
    scrapeTimezone: 'Asia/Dubai',
    enabled: false
  };

  target.description = target.description || 'Gulf-region lead outreach — same pipeline as Co-Ventech, Apify actor IoSHqwTR9YGhzccez.';
  target.website = target.website || source.website;
  target.company = target.company || source.company;
  target.isActive = true;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is required in Agents/backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  const source = await Brand.findOne({ name: SOURCE_BRAND_NAME });
  if (!source) {
    console.error(`Source brand "${SOURCE_BRAND_NAME}" not found.`);
    process.exit(1);
  }

  let target = await Brand.findById(LEADS_GULF_BRAND_ID);
  if (!target) target = await Brand.findOne({ name: /^leads-gulf$/i });
  if (!target) {
    console.error(`Leads-Gulf brand not found (id=${LEADS_GULF_BRAND_ID}).`);
    process.exit(1);
  }

  console.log(`Source: ${source.name}`);
  console.log(`Target: ${target.name} (${target._id}) slug=${target.slug}\n`);

  copyBrandSettings(source, target);

  const fullDefaultInput = await getLeadsGulfDefaultInput();

  target.apify = {
    actorId: source.apify?.actorId || 'IoSHqwTR9YGhzccez',
    apiToken: process.env.APIFY_API_TOKEN || source.apify?.apiToken,
    fetchCount: LEADS_GULF_TEST_FETCH_COUNT,
    defaultInput: fullDefaultInput
  };
  target.apify.defaultInput.fetch_count = LEADS_GULF_TEST_FETCH_COUNT;

  target.markModified('openai');
  target.markModified('abTest');
  target.markModified('campaign');
  target.markModified('qualification');
  target.markModified('cron');
  target.markModified('apify');

  await target.save();

  console.log('Saved full Apify defaultInput with', Object.keys(fullDefaultInput).length, 'fields');
  console.log('contact_location:', fullDefaultInput.contact_location.join(', '));
  console.log('fetch_count:', fullDefaultInput.fetch_count, `(test cap; Co-Ventech prod unchanged)`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
