/**
 * Twitter Jobs routes
 *
 * POST /run     — run actor, return all for preview (no DB write)
 * POST /import  — write selected jobs to DB
 * GET  /        — list jobs for brand (newest first)
 * GET  /:id     — single job
 * PUT  /:id     — update status, notes, assignedTo
 * DELETE /:id    — delete single job
 * DELETE /      — bulk delete
 * GET  /config  — get saved twitterJobs config (token masked)
 * PUT  /config  — save twitterJobs config
 */

const express = require('express');
const Brand    = require('../../models/Brand');
const TwitterJob = require('../../models/TwitterJob');
const { requireAuth }    = require('../middleware/auth');
const asyncHandler       = require('../middleware/asyncHandler');
const {
  runActor,
  buildTwitterJobsActorInput,
  sanitizeTwitterActorInput,
  mapToJobs,
  attachDedupeKey,
  dedupeTwitterJobs,
  buildExistingDedupeKeySet,
  buildTwitterJobDedupeKey,
  isRelevantTwitterJob,
  relevantJobsMongoFilter
} = require('../../services/twitterJobsService');
const { getApifyToken } = require('../../config/apify');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// ── GET /config ────────────────────────────────────────────────────────────────
router.get('/config', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId).select('twitterJobs');
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const cfg = brand.twitterJobs?.toObject?.() || brand.twitterJobs || {};
  return res.json({
    actorId:  cfg.actorId  || 'powerai~twitter-jobs-search-scraper',
    hasToken: !!getApifyToken(brand),
    enabled:  cfg.enabled ?? true
  });
}));

// ── PUT /config ───────────────────────────────────────────────────────────────
router.put('/config', asyncHandler(async (req, res) => {
  const { apiToken, actorId, enabled } = req.body;

  const update = {};
  if (apiToken && apiToken !== '••••••••') update['twitterJobs.apiToken'] = apiToken;
  if (actorId) update['twitterJobs.actorId'] = actorId;
  if (enabled != null) update['twitterJobs.enabled'] = enabled;

  const brand = await Brand.findByIdAndUpdate(req.params.brandId, { $set: update }, { new: true });
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  return res.json({
    actorId:  brand.twitterJobs?.actorId  || 'powerai~twitter-jobs-search-scraper',
    hasToken: !!getApifyToken(brand),
    enabled:  brand.twitterJobs?.enabled ?? true
  });
}));

// ── POST /run ────────────────────────────────────────────────────────────────
// Runs the actor, returns all scraped jobs for UI preview. NO DB writes.
router.post('/run', asyncHandler(async (req, res) => {
  const { keyword, maxResults, count, jobLocationType, location } = req.body;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'keyword is required' });
  }

  const brand = await Brand.findById(req.params.brandId).lean();
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const legacyTwitterInput = brand.twitterJobs?.defaultInput;
  if (legacyTwitterInput?.jobLocationId) {
    console.warn(
      '[TwitterJobs] Legacy brand.twitterJobs.defaultInput.jobLocationId in DB — ignored; run: node scripts/clearTwitterJobLocationId.js'
    );
  }

  const apiToken = getApifyToken(brand, req.body.apiToken);
  if (!apiToken) {
    return res.status(400).json({
      error: 'No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env (recommended) or enter a token above.'
    });
  }

  const actorId = brand.twitterJobs?.actorId || 'powerai~twitter-jobs-search-scraper';

  const input = sanitizeTwitterActorInput({
    keyword: keyword.trim(),
    maxResults: maxResults ?? count ?? 100,
    jobLocationType: jobLocationType ?? location
  });

  console.log(`[TwitterJobs] /run actor=${actorId} input=${JSON.stringify(input)} (jobLocationId omitted)`);

  let rawItems;
  try {
    rawItems = await runActor(apiToken, actorId, input);
  } catch (err) {
    return res.status(500).json({ error: `Actor failed: ${err.message}` });
  }

  if (!rawItems.length) {
    return res.json({ scraped: 0, jobs: [], message: 'Actor returned no results' });
  }

  const jobs = mapToJobs(rawItems);

  const existing = await TwitterJob.find({ brandId: brand._id })
    .select('rest_id dedupeKey title companyName location redirectUrl job_listing_id scrapedAt')
    .lean();
  const existingKeySet = buildExistingDedupeKeySet(existing);

  const jobsWithFlag = jobs.map(j => ({
    ...j,
    _exists: existingKeySet.has(j.dedupeKey || buildTwitterJobDedupeKey(j))
  }));

  console.log(`[TwitterJobs] /run complete: ${rawItems.length} raw → ${jobs.length} unique (${jobsWithFlag.filter(j => j._exists).length} already in DB)`);

  return res.json({
    scraped: jobs.length,
    rawScraped: rawItems.length,
    actorInput: input,
    jobs: jobsWithFlag
  });
}));

// ── POST /import ─────────────────────────────────────────────────────────────
router.post('/import', asyncHandler(async (req, res) => {
  const { jobs } = req.body;

  if (!Array.isArray(jobs) || jobs.length === 0) {
    return res.status(400).json({ error: 'jobs array is required' });
  }

  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const docs = jobs
    .filter(j => isRelevantTwitterJob(j))
    .map(({ _exists, ...j }) => attachDedupeKey({
      ...j,
      brandId: brand._id,
      status: 'new'
    }));

  if (!docs.length) {
    return res.json({ imported: 0, duplicatesSkipped: 0 });
  }

  const existing = await TwitterJob.find({ brandId: brand._id })
    .select('dedupeKey title companyName location redirectUrl job_listing_id rest_id')
    .lean();
  const existingKeySet = buildExistingDedupeKeySet(existing);

  const toAdd = [];
  for (const doc of docs) {
    if (existingKeySet.has(doc.dedupeKey)) continue;
    existingKeySet.add(doc.dedupeKey);
    toAdd.push(doc);
  }

  if (!toAdd.length) {
    return res.json({ imported: 0, duplicatesSkipped: docs.length, message: 'All jobs already exist' });
  }

  let inserted = 0;
  try {
    const result = await TwitterJob.insertMany(toAdd, { ordered: false });
    inserted = result.length;
  } catch (err) {
    if (err.code === 11000) {
      inserted = err.result?.nInserted || 0;
    } else {
      throw err;
    }
  }

  console.log(`[TwitterJobs] /import: ${inserted} jobs added to brand ${brand.name}`);

  return res.json({
    imported:          inserted,
    duplicatesSkipped:  docs.length - toAdd.length
  });
}));

// ── GET / ──────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 50 } = req.query;

  const filter = { brandId: req.params.brandId, ...relevantJobsMongoFilter() };
  if (status && status !== 'all') filter.status = status;
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { companyName: { $regex: search, $options: 'i' } },
      { location: { $regex: search, $options: 'i' } },
      { keyword: { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  const allMatching = await TwitterJob.find(filter).sort({ scrapedAt: -1 }).lean();
  const deduped = dedupeTwitterJobs(allMatching);
  const jobs = deduped.slice(skip, skip + limitNum);
  const total = deduped.length;

  return res.json({ jobs, total, page: parseInt(page), pages: Math.ceil(total / limitNum) || 1 });
}));

// ── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const job = await TwitterJob.findOne({ _id: req.params.id, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(job);
}));

// ── PUT /:id ───────────────────────────────────────────────────────────────────
router.put('/:id', asyncHandler(async (req, res) => {
  const allowed = ['status', 'assignedTo', 'userNotes', 'appliedAt', 'rejectedAt'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const job = await TwitterJob.findOneAndUpdate(
    { _id: req.params.id, brandId: req.params.brandId },
    { $set: updates },
    { new: true }
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });

  return res.json(job);
}));

// ── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const job = await TwitterJob.findOneAndDelete({ _id: req.params.id, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json({ ok: true });
}));

// ── DELETE / (bulk) ──────────────────────────────────────────────────────────
router.delete('/', asyncHandler(async (req, res) => {
  if (req.query.confirm !== 'true') {
    return res.status(400).json({ error: 'Must pass confirm=true to bulk delete' });
  }
  const result = await TwitterJob.deleteMany({ brandId: req.params.brandId });
  return res.json({ deleted: result.deletedCount });
}));

module.exports = router;