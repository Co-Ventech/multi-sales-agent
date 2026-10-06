/**
 * Update Gulf brand location configurations
 * Usage: node scripts/updateGulfBrandLocations.js
 *
 * Copies all LinkedIn/Upwork filter settings to Gulf brands,
 * only swapping locations to Gulf countries.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');

const GULF_COUNTRIES = [
  'Saudi Arabia',
  'Qatar',
  'United Arab Emirates',
  'Kuwait',
  'Oman',
  'Bahrain'
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/email_agent');

  // ── LinkedIn-Gulf ─────────────────────────────────────────────────────────────
  const linkedinBrand = await Brand.findOne({ name: /linkedin$/i });
  const linkedinGulf = await Brand.findById('6a0dcd2f4f14ae6d3c70aa01');

  if (linkedinGulf && linkedinBrand) {
    console.log(`LinkedIn-Gulf: copying filters from "${linkedinBrand.name}"`);
    const src = linkedinBrand.apify?.linkedinJobsDefaultInput || {};
    linkedinGulf.apify = linkedinGulf.apify || {};
    linkedinGulf.apify.linkedinJobsDefaultInput = {
      ...src,
      locations: GULF_COUNTRIES
    };
    await linkedinGulf.save();
    console.log(`  ✓ All LinkedIn filters preserved, locations → Gulf countries`);
    console.log(`  jobTitles: ${(linkedinGulf.apify.linkedinJobsDefaultInput.jobTitles || []).join(', ')}`);
    console.log(`  locations: ${linkedinGulf.apify.linkedinJobsDefaultInput.locations.join(', ')}`);
  }

  // ── Upwork-Gulf — apply ALL filters user specified ────────────────────────────
  const upworkGulf = await Brand.findById('6a0dcd424f14ae6d3c70aa2d');
  if (upworkGulf) {
    console.log(`\nUpwork-Gulf: applying full filter set with Gulf locations`);
    upworkGulf.apify = upworkGulf.apify || {};
    upworkGulf.apify.defaultInput = {
      clientHistory: ['noHires', '1to9Hires', '10+Hires'],
      experienceLevel: ['entry', 'intermediate', 'expert'],
      jobType: ['fixed', 'hourly'],
      location: GULF_COUNTRIES,
      maxJobAge: { value: 24, unit: 'hours' },
      page: 1,
      pagesToScrape: 1,
      paymentVerified: false,
      perPage: 10,
      query: 'qa-testing OR ai-machine-learning OR web-development OR mobile-development OR other-software-development OR desktop-application-development OR ecommerce-development OR web-mobile-software-dev',
      sort: 'newest'
    };
    await upworkGulf.save();
    console.log(`  ✓ All Upwork filters applied with Gulf locations`);
    console.log(`  Filters:`, JSON.stringify(upworkGulf.apify.defaultInput, null, 2));
  }

  console.log('\nDone!');
  await mongoose.disconnect();
}

main().catch(console.error);