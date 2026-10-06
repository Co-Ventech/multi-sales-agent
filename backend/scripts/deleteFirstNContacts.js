/**
 * deleteFirstNContacts.js
 * Deletes the first N Pending contacts for a brand (by insertion order).
 * Usage: node scripts/deleteFirstNContacts.js [slug] [n]
 *   slug - brand slug (default: co-ventech)
 *   n    - number of contacts to delete (default: 50)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');
const Contact = require('../src/models/Contact');

const BRAND_SLUG = process.argv[2] || 'co-ventech';
const N = parseInt(process.argv[3] || '50', 10);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) { console.error(`Brand not found: ${BRAND_SLUG}`); process.exit(1); }

  // Get first N Pending contacts sorted by _id (insertion order)
  const contacts = await Contact.find({ brandId: brand._id, status: 'Pending' })
    .sort({ _id: 1 })
    .limit(N)
    .select('_id email firstName lastName companyName');

  if (!contacts.length) {
    console.log('No Pending contacts found.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${contacts.length} Pending contacts to delete (first ${N}):`);
  contacts.slice(0, 5).forEach(c => console.log(`  ${c.email} — ${c.firstName} ${c.lastName} @ ${c.companyName}`));
  if (contacts.length > 5) console.log(`  ... and ${contacts.length - 5} more`);

  const ids = contacts.map(c => c._id);
  const result = await Contact.deleteMany({ _id: { $in: ids } });
  console.log(`\n✅ Deleted ${result.deletedCount} contacts.`);

  const remaining = await Contact.countDocuments({ brandId: brand._id, status: 'Pending' });
  console.log(`Remaining Pending contacts: ${remaining}`);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
