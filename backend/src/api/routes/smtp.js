const express = require('express');
const nodemailer = require('nodemailer');
const SmtpAccount = require('../../models/SmtpAccount');
const SmtpDailyCount = require('../../models/SmtpDailyCount');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { encrypt, decrypt } = require('../../utils/crypto');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

// GET /api/brands/:brandId/smtp
router.get('/', asyncHandler(async (req, res) => {
  const accounts = await SmtpAccount.find({ brandId: req.params.brandId });

  // Mask passwords — never send encrypted or decrypted passwords to frontend
  const sanitized = accounts.map(a => {
    const obj = a.toObject();
    delete obj.passwordEncrypted;
    obj.password = '••••••••';
    return obj;
  });

  return res.json(sanitized);
}));

// POST /api/brands/:brandId/smtp
router.post('/', asyncHandler(async (req, res) => {
  const { password, ...rest } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const passwordEncrypted = encrypt(password);
  const account = await SmtpAccount.create({
    ...rest,
    brandId: req.params.brandId,
    passwordEncrypted
  });

  const obj = account.toObject();
  delete obj.passwordEncrypted;
  obj.password = '••••••••';

  return res.status(201).json(obj);
}));

// PUT /api/brands/:brandId/smtp/:accountId
router.put('/:accountId', asyncHandler(async (req, res) => {
  const account = await SmtpAccount.findOne({
    _id: req.params.accountId,
    brandId: req.params.brandId
  });

  if (!account) return res.status(404).json({ error: 'SMTP account not found' });

  const { password, ...rest } = req.body;

  // Re-encrypt password only if a new one is provided
  if (password && password !== '••••••••') {
    rest.passwordEncrypted = encrypt(password);
  }

  Object.assign(account, rest);
  await account.save();

  const obj = account.toObject();
  delete obj.passwordEncrypted;
  obj.password = '••••••••';

  return res.json(obj);
}));

// DELETE /api/brands/:brandId/smtp/:accountId
router.delete('/:accountId', asyncHandler(async (req, res) => {
  const account = await SmtpAccount.findOne({
    _id: req.params.accountId,
    brandId: req.params.brandId
  });

  if (!account) return res.status(404).json({ error: 'SMTP account not found' });

  await SmtpAccount.findByIdAndDelete(account._id);
  await SmtpDailyCount.deleteMany({ smtpAccountId: account._id });

  return res.json({ ok: true });
}));

// POST /api/brands/:brandId/smtp/:accountId/test
router.post('/:accountId/test', asyncHandler(async (req, res) => {
  const account = await SmtpAccount.findOne({
    _id: req.params.accountId,
    brandId: req.params.brandId
  });

  if (!account) return res.status(404).json({ error: 'SMTP account not found' });

  try {
    const password = decrypt(account.passwordEncrypted);
    const transporter = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.useSSL,
      auth: { user: account.username, pass: password }
    });

    await transporter.verify();
    return res.json({ ok: true, message: 'SMTP connection successful' });
  } catch (err) {
    return res.json({ ok: false, message: err.message });
  }
}));

// GET /api/brands/:brandId/smtp/rotation
router.get('/rotation', asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const accounts = await SmtpAccount.find({ brandId: req.params.brandId });
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

module.exports = router;
