/**
 * Seed script — run once to create the "X" (Twitter) brand
 *
 * Usage: node seed-brand-x.js
 *
 * Requires MONGO_URI env var (or a .env file in backend/).
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Load .env manually
function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...vals] = line.split('=');
      if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
    });
}
loadEnv();

const Brand = require('./src/models/Brand');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const existing = await Brand.findOne({ slug: 'x' });
  if (existing) {
    console.log(`Brand "X" already exists (id: ${existing._id})`);
    console.log(`Slug: ${existing.slug}`);
    await mongoose.disconnect();
    return;
  }

  const brand = await Brand.create({
    name: 'X',
    slug: 'x',
    description: 'Twitter Jobs — Job listings scraped from X (Twitter) via Apify',
    website: 'https://x.com',
    twitterJobs: {
      enabled: true,
      actorId: 'powerai~twitter-jobs-search-scraper'
    },
    isActive: true
  });

  console.log(`✅ Brand "X" created`);
  console.log(`   ID:   ${brand._id}`);
  console.log(`   Slug: ${brand.slug}`);
  console.log(`   Name: ${brand.name}`);

  await mongoose.disconnect();
  console.log('Disconnected');
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});