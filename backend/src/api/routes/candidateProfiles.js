/**
 * candidateProfiles.js — Routes for candidate profile (resume CV) management.
 *
 *   GET  /api/candidate-profiles?brandId=      list ingested profiles
 *   POST /api/candidate-profiles/sync-folder   scan backend/data/resumes/ and ingest new PDFs
 *   POST /api/candidate-profiles/upload        direct multipart PDF upload (field name: resume)
 *
 * All handlers are additive: they only read/write the CandidateProfile
 * collection and never touch job, contact, or other system data.
 */

const express = require('express');
const multer = require('multer');
const CandidateProfile = require('../../models/CandidateProfile');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { syncResumeFolder, ingestResumeBuffer } = require('../../services/resumeIngestionService');
const { dedupeCandidates } = require('../../services/profileScoringService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(requireAuth);

// GET /api/candidate-profiles — return ALL candidate profiles so the dropdown
// and the AI scoring engine always see every stored CV. No brandId, isActive,
// or limit() restrictions that could silently exclude profiles.
router.get('/', asyncHandler(async (req, res) => {
  const all = await CandidateProfile.find({}).sort({ updatedAt: -1 }).lean();
  // Deduplicate by normalized name so the dropdown never lists the same person
  // twice (e.g., two ingested resumes for "Muhammad Aqib"). Keeps the most
  // complete profile as the representative.
  const profiles = dedupeCandidates(all);
  if (profiles.length !== all.length) {
    console.log('[CV API] Deduplicated candidates:', all.length, '->', profiles.length, 'unique');
  }
  console.log('[CV API] Returning total candidates from DB:', profiles.length);
  return res.json({ profiles });
}));

// POST /api/candidate-profiles/sync-folder — scan backend/data/resumes/
router.post('/sync-folder', asyncHandler(async (req, res) => {
  const brandId = req.body?.brandId || req.query.brandId || null;
  const result = await syncResumeFolder(brandId);
  return res.json({ success: true, ...result });
}));

// POST /api/candidate-profiles/upload — direct multipart PDF upload (field: resume)
router.post('/upload', upload.single('resume'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use a multipart field named "resume".' });
  }
  const brandId = req.body?.brandId || req.query.brandId || null;
  try {
    const profile = await ingestResumeBuffer(req.file.originalname, req.file.buffer, brandId);
    return res.status(201).json({ success: true, profile });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Resume ingestion failed' });
  }
}));

module.exports = router;