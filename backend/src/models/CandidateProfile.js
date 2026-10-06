/**
 * CandidateProfile.js — Stores AI-parsed candidate CV/resume data.
 *
 * This model is 100% additive to the system: it is a brand-new collection that
 * no existing workflow reads or mutates. It feeds the profile recommendation
 * engine (profileScoringService) and profile-gated cover letter generation.
 *
 * `brandId` is optional so that resumes dropped into backend/data/resumes/ (and
 * synced on startup without a brand context) can still be ingested. Uploaded
 * resumes can carry a brandId to scope them to a brand.
 */

const mongoose = require('mongoose');

const projectExperienceSchema = new mongoose.Schema({
  title: { type: String },
  description: { type: String },
  technologies: [{ type: String }],
  startDate: { type: String },
  endDate: { type: String }
}, { _id: false });

const employmentHistorySchema = new mongoose.Schema({
  title: { type: String },
  company: { type: String },
  duration: { type: String },
  description: { type: String }
}, { _id: false });

const educationSchema = new mongoose.Schema({
  degree: { type: String },
  institution: { type: String },
  year: { type: String }
}, { _id: false });

const candidateProfileSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand' },

  // Structured fields extracted from the resume by DeepSeek
  name: { type: String },
  professionalTitle: { type: String },
  yearsOfExperience: { type: Number },
  primarySkills: [{ type: String }],
  secondarySkills: [{ type: String }],
  technologies: [{ type: String }],
  frameworks: [{ type: String }],
  tools: [{ type: String }],
  cloudPlatforms: [{ type: String }],
  certifications: [{ type: String }],
  projectExperience: [projectExperienceSchema],
  employmentHistory: [employmentHistorySchema],
  education: [educationSchema],

  // Ingestion provenance
  rawText: { type: String },
  sourceFilename: { type: String },
  sourceHash: { type: String },   // sha256 of source PDF — prevents re-parsing identical files
  parsedAt: { type: Date }
}, {
  timestamps: true
});

// One profile per source file hash (per brand when scoped). Dedup key for
// resume folder sync and uploads.
candidateProfileSchema.index({ brandId: 1, sourceHash: 1 }, { unique: true });
candidateProfileSchema.index({ brandId: 1, name: 1 });

module.exports = mongoose.model('CandidateProfile', candidateProfileSchema);