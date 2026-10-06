// DB-backed SMTP account rotation
// Uses SmtpDailyCount collection — no JSON files

const SmtpDailyCount = require('../models/SmtpDailyCount');
const SmtpAccount = require('../models/SmtpAccount');

// Returns effective daily limit (with warmup ramp)
function getEffectiveLimit(account) {
  const full = account.dailyLimit || 10;
  if (!account.warmupStartDate) return full;

  const days = Math.floor((Date.now() - new Date(account.warmupStartDate)) / 86400000);
  if (days < 0) return 0;
  if (days < 7) return Math.min(full, 5);
  if (days < 14) return Math.min(full, 10);
  if (days < 21) return Math.min(full, 15);
  return full;
}

// Atomically claim one send slot for the account.
// Returns true if slot claimed, false if limit reached.
async function claimSendSlot(smtpAccount) {
  const today = new Date().toISOString().slice(0, 10);
  const limit = getEffectiveLimit(smtpAccount);

  // Atomic increment — only if current count < limit
  const result = await SmtpDailyCount.findOneAndUpdate(
    { smtpAccountId: smtpAccount._id, date: today, count: { $lt: limit } },
    { $inc: { count: 1 }, $set: { updatedAt: new Date(), brandId: smtpAccount.brandId } },
    { upsert: false, new: true }
  );

  if (result) return true;

  // No document exists yet — try upsert (count starts at 0 which is < limit)
  try {
    await SmtpDailyCount.findOneAndUpdate(
      { smtpAccountId: smtpAccount._id, date: today },
      {
        $inc: { count: 1 },
        $set: { updatedAt: new Date(), brandId: smtpAccount.brandId },
        $setOnInsert: { smtpAccountId: smtpAccount._id, date: today }
      },
      { upsert: true, new: true }
    );

    // Verify the upserted/incremented count doesn't exceed limit
    const doc = await SmtpDailyCount.findOne({ smtpAccountId: smtpAccount._id, date: today });
    if (doc && doc.count > limit) {
      // Roll back — we over-incremented
      await SmtpDailyCount.updateOne(
        { smtpAccountId: smtpAccount._id, date: today },
        { $inc: { count: -1 } }
      );
      return false;
    }
    return true;
  } catch (err) {
    // Duplicate key on upsert means another process created it — try the non-upsert path
    if (err.code === 11000) {
      const retry = await SmtpDailyCount.findOneAndUpdate(
        { smtpAccountId: smtpAccount._id, date: today, count: { $lt: limit } },
        { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
        { upsert: false, new: true }
      );
      return !!retry;
    }
    return false;
  }
}

// Get today's send count for an account
async function getTodayCount(smtpAccountId) {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await SmtpDailyCount.findOne({ smtpAccountId, date: today });
  return doc?.count || 0;
}

// Get best available SMTP account for brand (least used, has remaining capacity)
// Returns SmtpAccount doc or null if all exhausted
async function getNextAccount(brandId) {
  const accounts = await SmtpAccount.find({ brandId, isActive: true });
  if (!accounts.length) return null;

  const today = new Date().toISOString().slice(0, 10);
  const counts = await SmtpDailyCount.find({
    smtpAccountId: { $in: accounts.map(a => a._id) },
    date: today
  });

  const countMap = {};
  counts.forEach(c => { countMap[c.smtpAccountId.toString()] = c.count; });

  // Build eligible list with remaining capacity, sorted by least used first
  const eligible = accounts
    .map(a => ({
      account: a,
      sent: countMap[a._id.toString()] || 0,
      limit: getEffectiveLimit(a)
    }))
    .filter(e => e.sent < e.limit)
    .sort((a, b) => a.sent - b.sent); // prefer least used

  return eligible[0]?.account || null;
}

module.exports = { claimSendSlot, getTodayCount, getNextAccount, getEffectiveLimit };
