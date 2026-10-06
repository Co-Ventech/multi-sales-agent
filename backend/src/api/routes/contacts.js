const express = require('express');
const multer = require('multer');
const Contact = require('../../models/Contact');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { LeadQualifier } = require('../../services/qualifierService');
const { importFromSheet, syncStatusToSheet } = require('../../services/sheetsBiSync');
const importPhase = require('../../pipeline/importPhase');
const Brand = require('../../models/Brand');

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(requireAuth);

// GET /api/brands/:brandId/contacts
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, search, sort, dateFrom, dateTo, dateField = 'dateSent' } = req.query;
  const brandId = req.params.brandId;

  const query = { brandId };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (search) {
    const regex = new RegExp(search, 'i');
    query.$or = [
      { email: regex },
      { firstName: regex },
      { lastName: regex },
      { companyName: regex },
      { fullName: regex }
    ];
  }

  // Date range filter — supports dateSent, dateReplied, dateBounced, createdAt
  const allowedDateFields = new Set(['dateSent', 'dateReplied', 'dateBounced', 'createdAt']);
  if ((dateFrom || dateTo) && allowedDateFields.has(dateField)) {
    query[dateField] = {};
    if (dateFrom) query[dateField].$gte = new Date(dateFrom);
    if (dateTo) {
      // Make dateTo inclusive of the entire day
      const end = new Date(dateTo);
      end.setUTCHours(23, 59, 59, 999);
      query[dateField].$lte = end;
    }
  }

  let sortObj = { createdAt: -1 };
  if (sort) {
    const [field, dir] = sort.split(':');
    sortObj = { [field]: dir === 'asc' ? 1 : -1 };
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [contacts, total] = await Promise.all([
    Contact.find(query).sort(sortObj).skip(skip).limit(limitNum),
    Contact.countDocuments(query)
  ]);

  return res.json({
    contacts,
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum)
  });
}));

// PUT /api/brands/:brandId/contacts/:contactId
router.put('/:contactId', asyncHandler(async (req, res) => {
  const contact = await Contact.findOne({
    _id: req.params.contactId,
    brandId: req.params.brandId
  });

  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const allowed = ['status', 'notes', 'emailSubject', 'generatedEmailContent', 'abVariant', 'email', 'firstName', 'lastName', 'companyName', 'jobTitle'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      contact[key] = req.body[key];
    }
  }

  await contact.save();
  return res.json(contact);
}));

// POST /api/brands/:brandId/contacts/:contactId/generate
router.post('/:contactId/generate', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const contact = await Contact.findOne({ _id: req.params.contactId, brandId: req.params.brandId });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const OpenAIService = require('../../services/openaiService');
  const openai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);
  let result;
  try {
    result = await openai.generateEmail(contact.toObject(), brand, brand.openai?.systemPrompt || null);
  } catch (err) {
    if (err.code === 'QUOTA_EXCEEDED') {
      return res.status(429).json({ error: 'OpenAI quota exceeded — please top up the OpenAI account' });
    }
    return res.status(500).json({ error: err.message || 'OpenAI generation failed' });
  }

  if (!result || !result.subject || !result.body) {
    return res.status(500).json({ error: 'OpenAI generation failed' });
  }

  await Contact.findByIdAndUpdate(contact._id, {
    status: 'Generated',
    emailSubject: result.subject,
    generatedEmailContent: result.body
  });

  return res.json({ ok: true, subject: result.subject, body: result.body, tokens: result.tokens });
}));

// POST /api/brands/:brandId/contacts/:contactId/send
router.post('/:contactId/send', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const contact = await Contact.findOne({ _id: req.params.contactId, brandId: req.params.brandId });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  if (!contact.generatedEmailContent || !contact.emailSubject) {
    return res.status(400).json({ error: 'No generated email — generate the email first' });
  }

  const { getNextAccount, claimSendSlot } = require('../../services/rotationService');
  const SmtpSender = require('../../services/smtpSender');
  const EmailLog = require('../../models/EmailLog');
  const SmtpAccount = require('../../models/SmtpAccount');

  // If a specific SMTP account was picked in the UI, use it; otherwise auto-rotate.
  let smtpAccount;
  if (req.body?.smtpAccountId) {
    smtpAccount = await SmtpAccount.findOne({
      _id: req.body.smtpAccountId,
      brandId: brand._id,
      isActive: true
    });
    if (!smtpAccount) return res.status(400).json({ error: 'Selected SMTP account not found or inactive' });
  } else {
    smtpAccount = await getNextAccount(brand._id);
  }
  if (!smtpAccount) return res.status(400).json({ error: 'No SMTP accounts available' });

  const slotClaimed = await claimSendSlot(smtpAccount);
  if (!slotClaimed) return res.status(400).json({ error: 'SMTP daily limit reached' });

  const logger = { info: m => console.log('[SingleSend]', m), warn: m => console.warn('[SingleSend]', m), error: m => console.error('[SingleSend]', m), debug: () => {} };
  const sender = new SmtpSender(smtpAccount, logger);
  const result = await sender.send(contact.email, contact.emailSubject, contact.generatedEmailContent);

  if (result.success) {
    await Contact.findByIdAndUpdate(contact._id, {
      status: 'Sent',
      dateSent: new Date(),
      generatedEmailContent: result.processedBody,
      smtpAccountId: smtpAccount._id,
      sentFrom: smtpAccount.fromEmail,
      errorMessage: null
    });
    await EmailLog.create({
      brandId: brand._id, contactId: contact._id, smtpAccountId: smtpAccount._id,
      type: 'initial', subject: contact.emailSubject, body: result.processedBody,
      to: contact.email, from: smtpAccount.fromEmail, status: 'sent', messageId: result.messageId
    });
    return res.json({ ok: true, sentFrom: smtpAccount.fromEmail });
  } else {
    await Contact.findByIdAndUpdate(contact._id, { status: 'Failed', errorMessage: result.error });
    return res.status(500).json({ error: result.error });
  }
}));

// POST /api/brands/:brandId/contacts/:contactId/send-followup
// Send a follow-up email to one contact, ignoring the day-cutoff. Useful for testing.
router.post('/:contactId/send-followup', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const contact = await Contact.findOne({ _id: req.params.contactId, brandId: req.params.brandId });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  if (brand.campaign?.followUpsEnabled === false && !req.body?.dryRun) {
    return res.status(400).json({ error: 'Follow-ups are disabled for this brand. Enable in Settings · Campaign · Follow-Ups.' });
  }
  if (contact.status !== 'Sent' || !contact.dateSent) {
    return res.status(400).json({ error: 'Contact must have status=Sent and a dateSent before a follow-up can be sent' });
  }
  if (contact.dateReplied) return res.status(400).json({ error: 'Contact has already replied' });
  if (contact.dateBounced) return res.status(400).json({ error: 'Contact bounced — cannot follow up' });

  const followUpNum = (contact.followUps?.length || 0) + 1;

  const OpenAIService = require('../../services/openaiService');
  const SmtpSender = require('../../services/smtpSender');
  const { getNextAccount, claimSendSlot } = require('../../services/rotationService');
  const { checkSpam } = require('../../services/spamFilter');
  const SmtpAccount = require('../../models/SmtpAccount');
  const EmailLog = require('../../models/EmailLog');

  const openai = new OpenAIService(process.env.OPENAI_API_KEY, brand.openai?.model);

  let gen;
  try {
    gen = await openai.generateFollowUp(contact.toObject(), brand, followUpNum);
  } catch (err) {
    if (err.code === 'QUOTA_EXCEEDED') {
      return res.status(429).json({ error: 'OpenAI quota exceeded' });
    }
    return res.status(500).json({ error: err.message || 'Follow-up generation failed' });
  }
  if (!gen || !gen.subject || !gen.body) {
    return res.status(500).json({ error: 'Follow-up generation failed' });
  }

  if (brand.campaign?.spamFilter) {
    const spam = checkSpam(gen.subject, gen.body);
    if (!spam.passed) {
      return res.status(400).json({ error: `Spam filter blocked: ${spam.matches.join(', ')}` });
    }
  }

  // dryRun: return generated content only, don't send
  if (req.body?.dryRun) {
    return res.json({ ok: true, dryRun: true, followUpNum, subject: gen.subject, body: gen.body });
  }

  // Pick SMTP account
  let smtpAccount;
  if (req.body?.smtpAccountId) {
    smtpAccount = await SmtpAccount.findOne({ _id: req.body.smtpAccountId, brandId: brand._id, isActive: true });
    if (!smtpAccount) return res.status(400).json({ error: 'Selected SMTP account not found or inactive' });
  } else {
    smtpAccount = await getNextAccount(brand._id);
  }
  if (!smtpAccount) return res.status(400).json({ error: 'No SMTP accounts available' });

  const slotClaimed = await claimSendSlot(smtpAccount);
  if (!slotClaimed) return res.status(400).json({ error: 'SMTP daily limit reached' });

  const logger = { info: m => console.log('[SingleFollowup]', m), warn: m => console.warn('[SingleFollowup]', m), error: m => console.error('[SingleFollowup]', m), debug: () => {} };
  const sender = new SmtpSender(smtpAccount, logger);
  const result = await sender.send(contact.email, gen.subject, gen.body, null, null, null, null);

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  const fuEntry = {
    num: followUpNum,
    subject: gen.subject,
    body: result.processedBody,
    sentAt: new Date(),
    smtpAccountId: smtpAccount._id
  };
  await Contact.findByIdAndUpdate(contact._id, { $push: { followUps: fuEntry } });
  await EmailLog.create({
    brandId: brand._id, contactId: contact._id, smtpAccountId: smtpAccount._id,
    type: `followup_${followUpNum}`, subject: gen.subject, body: result.processedBody,
    to: contact.email, from: smtpAccount.fromEmail, status: 'sent', messageId: result.messageId
  });

  return res.json({ ok: true, followUpNum, subject: gen.subject, sentFrom: smtpAccount.fromEmail });
}));

// DELETE /api/brands/:brandId/contacts/:contactId
router.delete('/:contactId', asyncHandler(async (req, res) => {
  const contact = await Contact.findOne({
    _id: req.params.contactId,
    brandId: req.params.brandId
  });

  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  await Contact.findByIdAndDelete(contact._id);
  return res.json({ ok: true });
}));

// GET /api/brands/:brandId/contacts/export
router.get('/export', asyncHandler(async (req, res) => {
  const contacts = await Contact.find({ brandId: req.params.brandId }).lean();

  const headers = [
    'email', 'firstName', 'lastName', 'jobTitle', 'companyName',
    'industry', 'country', 'status', 'abVariant', 'leadScore',
    'dateSent', 'dateReplied', 'dateBounced', 'sentFrom', 'notes'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [
    headers.join(','),
    ...contacts.map(c => headers.map(h => escapeCSV(c[h])).join(','))
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="contacts-${req.params.brandId}-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(rows.join('\n'));
}));

// POST /api/brands/:brandId/contacts/import/json
router.post('/import/json', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let leads;
  try {
    leads = JSON.parse(req.file.buffer.toString('utf8'));
    if (!Array.isArray(leads)) {
      return res.status(400).json({ error: 'File must be a JSON array of leads' });
    }
  } catch (err) {
    return res.status(400).json({ error: `Invalid JSON: ${err.message}` });
  }

  const Brand = require('../../models/Brand');
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const logger = {
    info: (m) => console.log('[Import]', m),
    warn: (m) => console.warn('[Import]', m),
    error: (m) => console.error('[Import]', m),
    debug: (m) => {}
  };

  const qualifier = new LeadQualifier(logger, brand.qualification?.threshold ?? 6);
  const { qualified, stats } = qualifier.qualifyBatch(leads);

  if (!qualified.length) {
    return res.json({ imported: 0, qualified: 0, total: leads.length, stats });
  }

  // Deduplicate
  const emails = qualified.map(l => (l.email || '').toLowerCase()).filter(Boolean);
  const existing = await Contact.find({ brandId: brand._id, email: { $in: emails } }).select('email');
  const existingSet = new Set(existing.map(c => c.email.toLowerCase()));

  const toAdd = qualified.filter(l => l.email && !existingSet.has(l.email.toLowerCase()));

  // Create an ImportBatch so users can pause/resume sends per file
  const ImportBatch = require('../../models/ImportBatch');
  const batch = await ImportBatch.create({
    brandId: brand._id,
    name: req.file.originalname || `upload-${new Date().toISOString().slice(0, 19)}.json`,
    source: 'json_upload',
    count: 0,
    paused: false
  });

  const docs = toAdd.map(l => ({
    brandId: brand._id,
    importBatchId: batch._id,
    email: l.email.toLowerCase(),
    firstName: l.first_name || '',
    lastName: l.last_name || '',
    fullName: l.full_name || '',
    jobTitle: l.job_title || '',
    headline: l.headline || '',
    seniorityLevel: l.seniority_level || '',
    functionalLevel: l.functional_level || '',
    companyName: l.company_name || l.organization_name || '',
    companyDomain: l.company_domain || '',
    companyWebsite: l.company_website || '',
    industry: l.industry || '',
    companySize: l.company_size ? String(l.company_size) : (l.employee_count ? String(l.employee_count) : ''),
    companyDescription: l.company_description || '',
    companyAnnualRevenue: l.company_annual_revenue || '',
    companyTotalFunding: l.company_total_funding_clean || '',
    companyLinkedin: l.company_linkedin || '',
    city: l.city || '',
    state: l.state || '',
    country: l.country || l.headquarters_country || '',
    technologyStack: Array.isArray(l.technology_stack) ? l.technology_stack : [],
    linkedinUrl: l.linkedin_url || '',
    leadScore: l._score || 0,
    scoreBreakdown: l._score_breakdown || {},
    status: 'Pending',
    importSource: 'json_upload'
  }));

  let inserted = 0;
  if (docs.length) {
    try {
      const result = await Contact.insertMany(docs, { ordered: false });
      inserted = result.length;
    } catch (err) {
      if (err.code === 11000) {
        inserted = (err.result?.nInserted || 0);
      } else {
        throw err;
      }
    }
  }

  // Update batch count (or remove if 0 to keep list clean)
  if (inserted > 0) {
    await ImportBatch.findByIdAndUpdate(batch._id, { count: inserted });
  } else {
    await ImportBatch.findByIdAndDelete(batch._id);
  }

  return res.json({
    imported: inserted,
    qualified: qualified.length,
    total: leads.length,
    duplicatesSkipped: qualified.length - toAdd.length,
    batchId: inserted > 0 ? batch._id : null,
    stats
  });
}));

// GET /api/brands/:brandId/import-batches — list upload batches with counts and paused state
router.get('/import-batches', asyncHandler(async (req, res) => {
  const ImportBatch = require('../../models/ImportBatch');
  const batches = await ImportBatch.find({ brandId: req.params.brandId }).sort({ createdAt: -1 });
  // Live counts (status breakdown) per batch — useful for the UI
  const ids = batches.map(b => b._id);
  const liveCounts = await Contact.aggregate([
    { $match: { importBatchId: { $in: ids } } },
    { $group: { _id: { batch: '$importBatchId', status: '$status' }, n: { $sum: 1 } } }
  ]);
  const byBatch = {};
  for (const r of liveCounts) {
    const k = String(r._id.batch);
    byBatch[k] = byBatch[k] || { total: 0, byStatus: {} };
    byBatch[k].total += r.n;
    byBatch[k].byStatus[r._id.status] = r.n;
  }
  return res.json(batches.map(b => ({
    _id: b._id,
    name: b.name,
    source: b.source,
    paused: b.paused,
    createdAt: b.createdAt,
    initialCount: b.count,
    live: byBatch[String(b._id)] || { total: 0, byStatus: {} }
  })));
}));

// PATCH /api/brands/:brandId/import-batches/:batchId — toggle paused (or rename)
router.patch('/import-batches/:batchId', asyncHandler(async (req, res) => {
  const ImportBatch = require('../../models/ImportBatch');
  const update = {};
  if (typeof req.body.paused === 'boolean') update.paused = req.body.paused;
  if (typeof req.body.name === 'string' && req.body.name.trim()) update.name = req.body.name.trim();
  const batch = await ImportBatch.findOneAndUpdate(
    { _id: req.params.batchId, brandId: req.params.brandId },
    update,
    { new: true }
  );
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  return res.json(batch);
}));

// POST /api/brands/:brandId/contacts/import/sheet — import from Google Sheet
router.post('/import/sheet', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const logger = {
    info:  m => console.log('[SheetImport]', m),
    warn:  m => console.warn('[SheetImport]', m),
    error: m => console.error('[SheetImport]', m),
    debug: () => {}
  };

  const leads = await importFromSheet(brand, logger);
  if (!leads.length) return res.json({ imported: 0, message: 'No new contacts found in sheet' });

  const imported = await importPhase(brand, logger, { leads, importSource: 'google_sheet' });
  return res.json({ imported, total: leads.length });
}));

// POST /api/brands/:brandId/contacts/sync/sheet — push statuses to Google Sheet
router.post('/sync/sheet', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const contacts = await Contact.find({ brandId: brand._id }).lean();

  const logger = {
    info:  m => console.log('[SheetSync]', m),
    warn:  m => console.warn('[SheetSync]', m),
    error: m => console.error('[SheetSync]', m),
    debug: () => {}
  };

  const result = await syncStatusToSheet(brand, contacts, logger);
  return res.json(result);
}));

// DELETE /api/brands/:brandId/contacts (bulk delete)
router.delete('/', asyncHandler(async (req, res) => {
  const { confirm } = req.body;
  if (!confirm) {
    return res.status(400).json({ error: 'Pass { confirm: true } in body to delete all contacts' });
  }

  const result = await Contact.deleteMany({ brandId: req.params.brandId });
  return res.json({ ok: true, deleted: result.deletedCount });
}));

module.exports = router;
