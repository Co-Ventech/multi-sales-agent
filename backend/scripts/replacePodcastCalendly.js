/**
 * One-shot: replace OLD Calendly URL with NEW in all Podcast brand
 * Generated email contents. Run on the server inside the backend dir.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');
const Contact = require('../src/models/Contact');

const OLD = 'https://calendly.com/syedzubair/meet-with-zubair';
const NEW = 'https://calendly.com/co-ventech-info/meet-with-zubair';

function rxEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const brand = await Brand.findOne({ name: 'Podcast' });
  if (!brand) {
    console.log('Podcast brand not found');
    process.exit(1);
  }

  const oldRx = new RegExp(rxEscape(OLD));
  const newRx = new RegExp(rxEscape(NEW));

  const before = await Contact.countDocuments({
    brandId: brand._id,
    status: 'Generated',
    generatedEmailContent: oldRx
  });
  console.log('PODCAST brand only — Generated contacts with OLD url:', before);

  if (before === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  const result = await Contact.updateMany(
    { brandId: brand._id, status: 'Generated' },
    [{
      $set: {
        generatedEmailContent: {
          $replaceAll: {
            input: '$generatedEmailContent',
            find: OLD,
            replacement: NEW
          }
        }
      }
    }]
  );
  console.log('Modified count:', result.modifiedCount);

  const stillOld = await Contact.countDocuments({
    brandId: brand._id,
    status: 'Generated',
    generatedEmailContent: oldRx
  });
  const nowNew = await Contact.countDocuments({
    brandId: brand._id,
    status: 'Generated',
    generatedEmailContent: newRx
  });
  console.log('After: still containing OLD =', stillOld, '| containing NEW =', nowNew);

  const sample = await Contact.findOne({
    brandId: brand._id,
    status: 'Generated',
    generatedEmailContent: newRx
  }).select('email generatedEmailContent');

  if (sample) {
    console.log('\n=== Sample after replacement (' + sample.email + ') ===');
    console.log(sample.generatedEmailContent.slice(0, 700));
  }

  process.exit(0);
})();
