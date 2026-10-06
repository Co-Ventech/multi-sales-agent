/**
 * triggerTestSend.js
 * Triggers a real send pipeline run (same code path as cron) with a small limit.
 * Usage: node scripts/triggerTestSend.js [slug] [limit]
 *   slug  - brand slug (default: co-ventech)
 *   limit - max emails to send (default: 2)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');
const CampaignRun = require('../src/models/CampaignRun');
const runner = require('../src/pipeline/runner');

const BRAND_SLUG = process.argv[2] || 'co-ventech';
const LIMIT = parseInt(process.argv[3] || '2', 10);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) { console.error(`Brand not found: ${BRAND_SLUG}`); process.exit(1); }

  // Check no run already in progress
  const existing = await CampaignRun.findOne({ brandId: brand._id, status: 'running' });
  if (existing) {
    console.error('Pipeline already running! Stop it first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Brand: ${brand.name} (${brand.slug})`);
  console.log(`Sending up to ${LIMIT} real email(s)...\n`);

  const results = await runner.run(brand._id, 'send', { limit: LIMIT });

  console.log('\n=== Results ===');
  console.log(`Sent:         ${results.sent}`);
  console.log(`Failed:       ${results.failed}`);
  console.log(`Spam blocked: ${results.spamBlocked}`);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
