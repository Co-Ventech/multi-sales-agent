/**
 * Seed script — run once to create the "Upwork MCP" brand
 *
 * Usage: node scripts/seedUpworkMCPBrand.js
 *
 * Idempotent: if a brand with slug 'upwork-mcp' already exists, it is left
 * untouched and reported. Only inserts when missing. Never modifies other brands.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');

const MCP_ORG_UID = '2091895146228151233';

async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is required in Agents/backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const existing = await Brand.findOne({ slug: 'upwork-mcp' });
  if (existing) {
    console.log(`Brand "Upwork MCP" already exists (id: ${existing._id})`);
    console.log(`Slug: ${existing.slug}`);
    console.log(`Provider: ${existing.apify?.provider || 'apify'}`);
    console.log(`Org UID: ${existing.apify?.mcpConfig?.orgUid || '(none)'}`);
    await mongoose.disconnect();
    return;
  }

  const brand = await Brand.create({
    name: 'Upwork MCP',
    slug: 'upwork-mcp',
    description: 'Upwork jobs scraped via the Upwork MCP endpoint (provider: mcp)',
    apify: {
      provider: 'mcp',
      mcpConfig: { orgUid: MCP_ORG_UID }
    },
    isActive: true
  });

  console.log(`Brand "Upwork MCP" created`);
  console.log(`   ID:   ${brand._id}`);
  console.log(`   Slug: ${brand.slug}`);
  console.log(`   Provider: ${brand.apify.provider}`);
  console.log(`   Org UID: ${brand.apify.mcpConfig.orgUid}`);

  await mongoose.disconnect();
  console.log('Disconnected');
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});