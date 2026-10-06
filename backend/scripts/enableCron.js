/**
 * enableCron.js — Enable cron scheduling for a brand and set a test schedule.
 * Usage: node scripts/enableCron.js [slug]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');

const BRAND_SLUG = process.argv[2] || 'co-ventech';

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) { console.error(`Brand not found: ${BRAND_SLUG}`); process.exit(1); }

  console.log('Current cron config:');
  console.log(JSON.stringify(brand.cron || {}, null, 2));
  console.log('isActive:', brand.isActive);

  // Enable cron with a send schedule every 5 minutes for testing
  // Change back to '0 9 * * 1-5' for production
  brand.isActive = true;
  brand.cron = {
    ...(brand.cron?.toObject?.() || brand.cron || {}),
    enabled: true,
    sendEmails: '*/5 * * * *',     // every 5 min — for testing; change to '0 9 * * 1-5' for prod
    sendFollowups: '0 13 * * 1-5',
    checkBounces: '0 8 * * *',
    scrapeLeads: '*/10 * * * *',
    scrapeLinkedin: '0 10 * * *',   // 10 AM daily — LinkedIn job + employee scrape
    timezone: brand.cron?.timezone || 'Asia/Karachi'
  };

  await brand.save();

  console.log('\n✅ Updated:');
  console.log(JSON.stringify(brand.cron, null, 2));
  console.log('\nNow restart the backend (rs in nodemon) — scheduler will pick it up.');

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
