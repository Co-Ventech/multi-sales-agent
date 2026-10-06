/**
 * LinkedinJob.js — Stores raw LinkedIn job posting data for a brand.
 * Separate from Contact so other brands are unaffected.
 */

const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name:           { type: String },
  linkedinUrl:    { type: String },
  website:        { type: String },
  description:    { type: String },
  size:           { type: String },         // "51-200" etc
  logo:           { type: String },         // image URL
  coverImage:     { type: String },         // cover image URL
  locations:      [{                        // array of {city, state, country, ...}
    country:       { type: String },
    geographicArea:{ type: String },
    city:          { type: String },
    headquarter:   { type: Boolean },
    text:          { type: String }
  }],
  industries:     [{ id: String, name: String }],  // [{name: "Software Development"}]
  specialities:   [{ type: String }],
  followerCount:  { type: Number }
}, { _id: false });

const linkedinJobSchema = new mongoose.Schema({
  brandId:        { type: mongoose.Schema.Types.ObjectId, required: true },

  // Job identity — used to avoid duplicates
  linkedinUrl:    { type: String, required: true },

  // Link back to the contact this job was enriched with
  linkedinContactId: { type: mongoose.Schema.Types.ObjectId, ref: 'LinkedinContact' },

  // Basic info
  title:          { type: String },
  descriptionText:{ type: String },
  descriptionHtml:{ type: String },

  // Job details
  employmentType:  { type: String },  // "full_time", "part_time"
  workplaceType:   { type: String },  // "remote", "on-site", "hybrid"
  experienceLevel: { type: String },  // "mid-senior", "associate", etc.
  jobFunctions:    [{ type: String }],
  benefits:        [{ type: String }],
  salaryText:      { type: String },
  salaryMin:       { type: Number },
  salaryMax:       { type: Number },

  // Metrics
  applicants:    { type: Number },
  views:          { type: Number },
  postedDate:     { type: Date },
  expiredAt:      { type: Date },

  // Location
  location: {
    linkedinText: { type: String },
    countryCode:  { type: String },
    regionCode:   { type: String },
    city:         { type: String },
    state:        { type: String },
    country:      { type: String }
  },

  // Company
  company: companySchema,

  // Apply
  applyMethod: {
    type:         { type: String },  // "OffsiteApply", "EasyApply"
    companyApplyUrl: { type: String }
  },

  // Job application tracker
  trackerStatus: {
    type: String,
    enum: ['new', 'applied', 'interview', 'offer', 'rejected', 'archived'],
    default: 'new'
  },
  appliedAt: { type: Date },
  rejectedAt: { type: Date },
  userNotes: { type: String },

  // AI-generated / user-edited cover letter (additive, optional)
  coverLetter:          { type: String },
  coverLetterUpdatedAt: { type: Date },

  // Additive AI profile recommendation fields (populated by profileScoringService)
  aiRecommendedProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'CandidateProfile' },
  aiRecommendedScore: { type: Number },
  selectedProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'CandidateProfile' },
  selectionSource: { type: String, enum: ['AI_RECOMMENDED', 'MANUAL_OVERRIDE'] },
  profileMatchScores: [{
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'CandidateProfile' },
    profileName: { type: String },
    score: { type: Number },
    breakdown: {
      skillsMatch: { type: Number },
      experienceMatch: { type: Number },
      technologyMatch: { type: Number },
      seniorityMatch: { type: Number },
      domainMatch: { type: Number },
      otherMatch: { type: Number }
    },
    reasoning: { type: String }
  }],
  profileSelectionReasoning: { type: String },

  // Source query that found this job
  query: {
    sortBy:           { type: String },
    workplaceType:    [{ type: String }],
    employmentType:   [{ type: String }],
    experienceLevel:  [{ type: String }],
    under10Applicants:{ type: Boolean },
    easyApply:        { type: Boolean },
    postedLimit:      { type: String },
    location:         { type: String }
  }
}, {
  timestamps: true
});

// Unique index on linkedinUrl per brand — prevents duplicate job storage
linkedinJobSchema.index({ brandId: 1, linkedinUrl: 1 }, { unique: true });

module.exports = mongoose.model('LinkedinJob', linkedinJobSchema);