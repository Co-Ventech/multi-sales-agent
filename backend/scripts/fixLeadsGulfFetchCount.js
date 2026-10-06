/**
 * Set Leads-Gulf apify.fetchCount + defaultInput.fetch_count to test value (10).
 * Run: node scripts/fixLeadsGulfFetchCount.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');
const { LEADS_GULF_TEST_FETCH_COUNT } = require('../src/config/apifyLeadsFilters');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const brand = await Brand.findOne({ slug: 'leads-gulf' });
  if (!brand) {
    console.error('Brand leads-gulf not found');
    process.exit(1);
  }
  brand.apify = brand.apify || {};
  brand.apify.fetchCount = LEADS_GULF_TEST_FETCH_COUNT;
  if (brand.apify.defaultInput) {
    const di = brand.apify.defaultInput.toObject?.() || brand.apify.defaultInput;
    brand.apify.defaultInput = { ...di, fetch_count: LEADS_GULF_TEST_FETCH_COUNT };
  }
  brand.markModified('apify');
  await brand.save();
  console.log(`Updated ${brand.name}: fetchCount=${LEADS_GULF_TEST_FETCH_COUNT}`);
  await mongoose.disconnect();
})();
