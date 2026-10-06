/**
 * Migrate all collections from local MongoDB to Atlas.
 * Usage: node scripts/migrateToAtlas.js
 */
const mongoose = require('mongoose');

const LOCAL_URI = 'mongodb://localhost:27017/email-agent';
const ATLAS_URI = 'mongodb+srv://admin:admin@cluster0.ifu0n.mongodb.net/email-agent?retryWrites=true&w=majority';

const COLLECTIONS = ['brands', 'contacts', 'emaillogs', 'campaignruns', 'smtpaccounts'];

async function migrate() {
  console.log('Connecting to local MongoDB...');
  const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();

  console.log('Connecting to Atlas...');
  const atlasConn = await mongoose.createConnection(ATLAS_URI).asPromise();

  for (const collName of COLLECTIONS) {
    try {
      const localColl = localConn.collection(collName);
      const atlasColl = atlasConn.collection(collName);

      const docs = await localColl.find({}).toArray();
      if (!docs.length) {
        console.log(`  ${collName}: empty, skipping`);
        continue;
      }

      // Delete existing Atlas data for this collection (clean sync)
      const deleted = await atlasColl.deleteMany({});
      console.log(`  ${collName}: cleared ${deleted.deletedCount} existing docs`);

      // Insert all local docs
      const result = await atlasColl.insertMany(docs, { ordered: false });
      console.log(`  ${collName}: inserted ${result.insertedCount} / ${docs.length} docs`);
    } catch (err) {
      console.error(`  ${collName}: ERROR — ${err.message}`);
    }
  }

  await localConn.close();
  await atlasConn.close();
  console.log('\nMigration complete.');
}

migrate().catch(e => { console.error(e.message); process.exit(1); });
