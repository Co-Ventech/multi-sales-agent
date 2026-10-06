const express = require('express');
const Brand = require('../../models/Brand');
const SmtpAccount = require('../../models/SmtpAccount');
const Contact = require('../../models/Contact');
const EmailLog = require('../../models/EmailLog');
const CampaignRun = require('../../models/CampaignRun');
const BounceEmail = require('../../models/BounceEmail');
const SmtpDailyCount = require('../../models/SmtpDailyCount');
const TwitterJob = require('../../models/TwitterJob');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const schedulerService = require('../../services/schedulerService');

const router = express.Router();

// All routes require auth
router.use(requireAuth);

// GET /api/brands
router.get('/', asyncHandler(async (req, res) => {
  const brands = await Brand.find().sort({ name: 1 });
  return res.json(brands);
}));

// POST /api/brands
router.post('/', asyncHandler(async (req, res) => {
  const data = req.body;

  // Auto-generate slug from name if not provided
  if (!data.slug && data.name) {
    data.slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // Ensure slug is unique
  const existing = await Brand.findOne({ slug: data.slug });
  if (existing) {
    data.slug = `${data.slug}-${Date.now()}`;
  }

  const brand = await Brand.create(data);

  // Schedule cron if enabled
  if (brand.cron?.enabled) {
    schedulerService.scheduleBrand(brand);
  }

  return res.status(201).json(brand);
}));

// GET /api/brands/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });
  return res.json(brand);
}));

// PUT /api/brands/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const updates = req.body;

  // Deep merge nested objects
  const nestedFields = ['company', 'openai', 'abTest', 'campaign', 'qualification', 'googleSheets', 'cron', 'slack', 'apify'];
  for (const field of nestedFields) {
    if (updates[field] && typeof updates[field] === 'object') {
      updates[field] = { ...brand[field]?.toObject?.() || brand[field] || {}, ...updates[field] };
    }
  }

  Object.assign(brand, updates);
  await brand.save();

  // Reschedule cron if cron settings changed
  if (brand.cron?.enabled) {
    schedulerService.scheduleBrand(brand);
  } else {
    schedulerService.cancelBrand(brand._id.toString());
  }

  return res.json(brand);
}));

// DELETE /api/brands/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  // Cancel scheduled crons
  schedulerService.cancelBrand(brand._id.toString());

  // Cascade delete all related data
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

  return res.json({ ok: true, message: 'Brand and all related data deleted' });
}));

module.exports = router;
