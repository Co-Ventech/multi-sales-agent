/**
 * Delete the X (Twitter) brand by ID
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

function loadEnv() {
  const envPath = path.join(__dirname, './.env');
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
const SmtpAccount = require('./src/models/SmtpAccount');
const Contact = require('./src/models/Contact');
const EmailLog = require('./src/models/EmailLog');
const CampaignRun = require('./src/models/CampaignRun');
const BounceEmail = require('./src/models/BounceEmail');
const SmtpDailyCount = require('./src/models/SmtpDailyCount');
const TwitterJob = require('./src/models/TwitterJob');

const BRAND_ID = process.argv[2] || '6a0c396e77dc5e6ab5a37b0d';

async function deleteBrand() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const brand = await Brand.findById(BRAND_ID);
  if (!brand) {
    console.log(`Brand not found: ${BRAND_ID}`);
    await mongoose.disconnect();
    return;
  }

  console.log(`Deleting brand: ${brand.name} (${brand._id})`);

  const smtpAccounts = await SmtpAccount.find({ brandId: brand._id });
  const smtpIds = smtpAccounts.map(a => a._id);

  await Promise.all([
    SmtpAccount.deleteMany({ brandId: brand._id }),
    Contact.deleteMany({ brandId: brand._id }),
    EmailLog.deleteMany({ brandId: brand._id }),
    CampaignRun.deleteMany({ brandId: brand._id }),
    BounceEmail.deleteMany({ brandId: brand._id }),
    SmtpDailyCount.deleteMany({ smtpAccountId: { $in: smtpIds } }),
    TwitterJob.deleteMany({ brandId: brand._id })
  ]);

  await Brand.findByIdAndDelete(brand._id);

  console.log('Done - brand and all related data deleted');
  await mongoose.disconnect();
}

deleteBrand().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});