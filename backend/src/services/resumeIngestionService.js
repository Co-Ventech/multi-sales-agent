/**
 * resumeIngestionService.js — Dynamic CV ingestion from resume PDFs.
 *
 * Scans backend/data/resumes/ (on startup or via POST /api/candidate-profiles/sync-folder)
 * and handles direct multipart uploads (POST /api/candidate-profiles/upload).
 * Each PDF is: read → text-extracted via pdf-parse → parsed by DeepSeek into a
 * structured CandidateProfile → upserted keyed on a sha256 hash of the file so
 * identical files are never re-parsed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFParse } = require('pdf-parse');
const CandidateProfile = require('../models/CandidateProfile');
const { extractProfileFromResume } = require('./deepseekService');

// backend/data/resumes (backend/src/services -> backend/data/resumes)
const RESUMES_DIR = path.join(__dirname, '..', '..', 'data', 'resumes');

function ensureResumesDir() {
  if (!fs.existsSync(RESUMES_DIR)) {
    fs.mkdirSync(RESUMES_DIR, { recursive: true });
  }
  return RESUMES_DIR;
}

/** Extract plain text from a PDF buffer using pdf-parse v2. */
async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result && result.text ? String(result.text) : '';
}

function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Parse resume text via DeepSeek and upsert the CandidateProfile.
 * @param {object} opts
 * @param {string} opts.rawText - extracted PDF text
 * @param {string} opts.filename - original file name
 * @param {string} opts.hash - sha256 of the file
 * @param {mongoose.Types.ObjectId|string|null} opts.brandId
 * @returns {Promise<object>} saved CandidateProfile document
 */
async function upsertProfileFromText({ rawText, filename, hash, brandId }) {
  console.log('[CV INGESTION] Processing file:', filename);
  const profileData = await extractProfileFromResume(rawText);
  const profileName = profileData && profileData.name ? profileData.name : filename;

  // Dedup on the file hash (per brand when scoped).
  const filter = { sourceHash: hash };
  if (brandId) filter.brandId = brandId;

  const existing = await CandidateProfile.findOne(filter).lean();

  const doc = {
    ...profileData,
    brandId: brandId || existing?.brandId || null,
    rawText: String(rawText).slice(0, 30000),
    sourceFilename: filename,
    sourceHash: hash,
    parsedAt: new Date(),
    updatedAt: new Date()
  };

  const profile = await CandidateProfile.findOneAndUpdate(
    filter,
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log('[CV INGESTION] Profile updated/saved:', profile.name || profileName);
  return profile;
}

/**
 * Ingest a single resume PDF from memory (multipart upload).
 * @param {string} originalName - uploaded file name
 * @param {Buffer} buffer - PDF bytes
 * @param {string|null} brandId
 * @returns {Promise<object>} saved CandidateProfile document
 */
async function ingestResumeBuffer(originalName, buffer, brandId) {
  if (!buffer || !buffer.length) {
    const err = new Error('Empty file received');
    err.status = 400;
    throw err;
  }
  const rawText = await extractTextFromPdf(buffer);
  if (!rawText || !String(rawText).trim()) {
    const err = new Error('Could not extract any text from this PDF. Ensure it is a text-based resume.');
    err.status = 422;
    throw err;
  }
  const hash = computeFileHash(buffer);
  return upsertProfileFromText({ rawText, filename: originalName, hash, brandId });
}

/**
 * Scan backend/data/resumes/ and ingest every PDF that has not already been
 * parsed (deduped by file hash).
 * @param {string|null} brandId
 * @returns {Promise<{processed: Array, skipped: string[], errors: Array, total: number}>}
 */
async function syncResumeFolder(brandId) {
  ensureResumesDir();
  const files = fs.readdirSync(RESUMES_DIR).filter((f) => /\.pdf$/i.test(f));

  const processed = [];
  const skipped = [];
  const errors = [];

  for (const file of files) {
    const fullPath = path.join(RESUMES_DIR, file);
    try {
      const buffer = fs.readFileSync(fullPath);
      const hash = computeFileHash(buffer);

      const dupFilter = { sourceHash: hash };
      if (brandId) dupFilter.brandId = brandId;
      const existing = await CandidateProfile.findOne(dupFilter).lean();
      if (existing) {
        skipped.push(file);
        continue;
      }

      const rawText = await extractTextFromPdf(buffer);
      if (!rawText || !String(rawText).trim()) {
        throw new Error('No extractable text in PDF');
      }

      const profile = await upsertProfileFromText({ rawText, filename: file, hash, brandId });
      processed.push({ file, profileId: profile._id, name: profile.name || file });
    } catch (err) {
      console.error('[CV INGESTION] Failed:', file, err.message);
      errors.push({ file, error: err.message });
    }
  }

  console.log(
    `[CV INGESTION] Folder sync complete: ${processed.length} processed, ${skipped.length} skipped (already parsed), ${errors.length} errors`
  );
  return { processed, skipped, errors, total: files.length };
}

module.exports = { RESUMES_DIR, ensureResumesDir, syncResumeFolder, ingestResumeBuffer, extractTextFromPdf };