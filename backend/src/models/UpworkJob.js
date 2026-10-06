const mongoose = require('mongoose');

const upworkJobSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },

  // Upwork native fields
  jobId: { type: String, required: true },
  url: { type: String },
  title: { type: String },
  description: { type: String },
  budget: { type: String },           // may contain "$500-$1000" or single value
  clientLocation: { type: String },
  clientName: { type: String },
  clientNameConfidence: { type: Number },
  clientAvgHourlyRate: { type: Number },
  clientRating: { type: Number },
  clientHireRatePercent: { type: Number },
  clientTotalSpent: { type: Number },
  hasHired: { type: Boolean, default: false },
  proposals: { type: Number },
  paymentVerified: { type: Boolean, default: false },
  relativeDate: { type: String },
  absoluteDate: { type: String },
  jobType: { type: String },           // fixed | hourly
  experienceLevel: { type: String },  // entry | intermediate | expert
  allowedApplicantCountries: [{ type: String }],
  tags: [{ type: String }],
  questions: [{ type: mongoose.Schema.Types.Mixed }],

  // Extracted enrichment fields
  extractedCompanies: [{ type: String }],    // company names regexed from description
  extractedLinkedinUrls: [{ type: String }],  // LinkedIn company URLs from description
  extractedCompany: { type: String },         // best company name (from desc/regex or clientName fallback)
  extractedOtherUrls: [{ type: String }],     // other URLs from description

  // Status tracking
  status: { type: String, default: 'new' },  // new | processed | error
  // Job application tracker
  trackerStatus: {
    type: String,
    enum: ['new', 'applied', 'interview', 'offer', 'rejected', 'archived'],
    default: 'new'
  },
  appliedAt: { type: Date },
  rejectedAt: { type: Date },
  userNotes: { type: String },

  // Additive AI cover letter fields
  coverLetter: { type: String },
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

  // Additive MCP enrichment fields
  skills: [{ type: String }],
  category: { type: String },
  subcategory: { type: String },
  jobStatus: { type: String },
  lastVerifiedAt: { type: Date },
  source: { type: String, default: 'apify' }
}, {
  timestamps: true
});

// Compound unique index: one UpworkJob per jobId per brand
upworkJobSchema.index({ brandId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('UpworkJob', upworkJobSchema);