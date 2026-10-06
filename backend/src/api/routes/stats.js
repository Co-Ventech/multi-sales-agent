const express = require('express');
const Contact = require('../../models/Contact');
const EmailLog = require('../../models/EmailLog');
const SmtpAccount = require('../../models/SmtpAccount');
const SmtpDailyCount = require('../../models/SmtpDailyCount');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

// GET /api/brands/:brandId/stats
//   Optional ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD — returns sent/replied/bounced
//   counts within that range. If omitted, defaults to today (sentToday/repliedToday)
//   for backwards compatibility.
router.get('/', asyncHandler(async (req, res) => {
  const brandId = req.params.brandId;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayStart = new Date(todayStr + 'T00:00:00.000Z');
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

  // Optional date range
  const { dateFrom, dateTo } = req.query;
  let rangeStart = null;
  let rangeEnd = null;
  if (dateFrom || dateTo) {
    if (dateFrom) rangeStart = new Date(dateFrom + 'T00:00:00.000Z');
    if (dateTo) {
      rangeEnd = new Date(dateTo + 'T23:59:59.999Z');
    }
  }
  const rangeFilter = (field) => {
    const f = {};
    if (rangeStart) f.$gte = rangeStart;
    if (rangeEnd) f.$lte = rangeEnd;
    return Object.keys(f).length ? f : null;
  };

  const dateSentRange = rangeFilter('dateSent');
  const dateReplyRange = rangeFilter('dateReplied');
  const dateBounceRange = rangeFilter('dateBounced');

  const [
    total,
    byStatusAgg,
    sentToday,
    sentYesterday,
    repliedToday,
    repliedYesterday,
    bouncedToday,
    bouncedYesterday,
    sentInRange,
    repliedInRange,
    bouncedInRange,
    totalEmailsSent
  ] = await Promise.all([
    Contact.countDocuments({ brandId }),
    Contact.aggregate([
      { $match: { brandId: require('mongoose').Types.ObjectId.createFromHexString(brandId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    Contact.countDocuments({ brandId, dateSent: { $gte: todayStart } }),
    Contact.countDocuments({ brandId, dateSent: { $gte: yesterdayStart, $lt: todayStart } }),
    Contact.countDocuments({ brandId, dateReplied: { $gte: todayStart } }),
    Contact.countDocuments({ brandId, dateReplied: { $gte: yesterdayStart, $lt: todayStart } }),
    Contact.countDocuments({ brandId, dateBounced: { $gte: todayStart } }),
    Contact.countDocuments({ brandId, dateBounced: { $gte: yesterdayStart, $lt: todayStart } }),
    dateSentRange ? Contact.countDocuments({ brandId, dateSent: dateSentRange }) : Promise.resolve(null),
    dateReplyRange ? Contact.countDocuments({ brandId, dateReplied: dateReplyRange }) : Promise.resolve(null),
    dateBounceRange ? Contact.countDocuments({ brandId, dateBounced: dateBounceRange }) : Promise.resolve(null),
    EmailLog.countDocuments({ brandId, status: 'sent' })
  ]);

  const byStatus = {};
  const statuses = ['Pending', 'Generated', 'Sent', 'Failed', 'Bounced', 'Replied', 'Unsubscribed', 'SpamBlocked', 'DryRun'];
  statuses.forEach(s => { byStatus[s] = 0; });
  byStatusAgg.forEach(a => { byStatus[a._id] = a.count; });

  const totalSent = byStatus['Sent'] || 0;
  const totalBounced = byStatus['Bounced'] || 0;
  const totalReplied = byStatus['Replied'] || 0;
  const bounceRate = totalSent > 0 ? Math.round((totalBounced / totalSent) * 100) : 0;
  const replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  return res.json({
    total,
    byStatus,
    totalEmailsSent,                        // lifetime count of all emails ever sent (initial + follow-ups)
    sentToday,
    sentYesterday,
    repliedToday,
    repliedYesterday,
    bouncedToday,
    bouncedYesterday,
    bounceRate,
    replyRate,
    range: (dateFrom || dateTo) ? {
      from: dateFrom || null,
      to: dateTo || null,
      sent: sentInRange,
      replied: repliedInRange,
      bounced: bouncedInRange
    } : null
  });
}));

// GET /api/brands/:brandId/stats/costs
router.get('/costs', asyncHandler(async (req, res) => {
  const brandId = req.params.brandId;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const dailyCounts = await EmailLog.aggregate([
    {
      $match: {
        brandId: require('mongoose').Types.ObjectId.createFromHexString(brandId),
        sentAt: { $gte: thirtyDaysAgo },
        status: 'sent'
      }
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return res.json(dailyCounts.map(d => ({ date: d._id, count: d.count })));
}));

// GET /api/brands/:brandId/stats/rotation
router.get('/rotation', asyncHandler(async (req, res) => {
  const brandId = req.params.brandId;
  const today = new Date().toISOString().slice(0, 10);

  const accounts = await SmtpAccount.find({ brandId });
  const counts = await SmtpDailyCount.find({
    smtpAccountId: { $in: accounts.map(a => a._id) },
    date: today
  });

  const countMap = {};
  counts.forEach(c => { countMap[c.smtpAccountId.toString()] = c.count; });

  const result = accounts.map(a => ({
    accountId: a._id,
    fromEmail: a.fromEmail,
    senderName: a.senderName,
    dailyLimit: a.dailyLimit,
    todayCount: countMap[a._id.toString()] || 0,
    isActive: a.isActive
  }));

  return res.json(result);
}));

// GET /api/brands/:brandId/stats/logs
router.get('/logs', asyncHandler(async (req, res) => {
  const logs = await EmailLog.find({ brandId: req.params.brandId })
    .sort({ sentAt: -1 })
    .limit(100)
    .populate('contactId', 'email firstName lastName companyName')
    .populate('smtpAccountId', 'fromEmail senderName');

  return res.json(logs);
}));

// GET /api/brands/:brandId/stats/ab
// Returns sent/replied/bounced counts broken down by A/B variant
router.get('/ab', asyncHandler(async (req, res) => {
  const brandId = req.params.brandId;
  const oid = require('mongoose').Types.ObjectId.createFromHexString(brandId);

  const agg = await Contact.aggregate([
    { $match: { brandId: oid, abVariant: { $in: ['A', 'B'] } } },
    {
      $group: {
        _id: { variant: '$abVariant', status: '$status' },
        count: { $sum: 1 }
      }
    }
  ]);

  const result = {
    A: { sent: 0, replied: 0, bounced: 0, failed: 0, total: 0 },
    B: { sent: 0, replied: 0, bounced: 0, failed: 0, total: 0 }
  };

  agg.forEach(({ _id, count }) => {
    const v = _id.variant;
    const s = _id.status;
    if (!result[v]) return;
    result[v].total += count;
    if (s === 'Sent')    result[v].sent    += count;
    if (s === 'Replied') result[v].replied += count;
    if (s === 'Bounced') result[v].bounced += count;
    if (s === 'Failed')  result[v].failed  += count;
  });

  // Compute reply rates
  for (const v of ['A', 'B']) {
    const base = result[v].sent + result[v].replied + result[v].bounced;
    result[v].replyRate   = base > 0 ? Math.round((result[v].replied / base) * 100) : 0;
    result[v].bounceRate  = base > 0 ? Math.round((result[v].bounced / base) * 100) : 0;
  }

  return res.json(result);
}));

module.exports = router;
