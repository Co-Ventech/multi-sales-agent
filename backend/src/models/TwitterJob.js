const mongoose = require('mongoose');

const twitterJobSchema = new mongoose.Schema({
  brandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand',
    required: true,
    index: true
  },

  // Raw Apify fields
  rest_id: { type: String, index: true },
  job_listing_id: { type: String },
  /** Stable key for deduping same listing across different rest_ids / scrapes */
  dedupeKey: { type: String, index: true },
  keyword: { type: String },
  jobLocationType: { type: String },

  // Company info
  companyName:  { type: String },
  companyDomain: { type: String },
  companyLogo:  { type: String },

  // Job details
  title:       { type: String },
  location:    { type: String },
  redirectUrl: { type: String },

  // Salary (nullable)
  salaryCurrency: { type: String },
  salaryMin:      { type: Number },
  salaryMax:      { type: Number },
  salaryInterval: { type: Number },  // 1 = per year, 12 = per month
  formattedSalary: { type: String },

  // Poster info (user who posted the job)
  posterName:       { type: String },
  posterScreenName: { type: String },
  posterProfileUrl: { type: String },
  posterVerified:   { type: Boolean, default: false },

  // Tracking
  scrapedAt: { type: Date, default: Date.now },

  // Status per brand workflow
  status: {
    type: String,
    enum: ['new', 'applied', 'interview', 'offer', 'rejected', 'archived'],
    default: 'new'
  },

  // Which user marked it / notes
  assignedTo:   { type: String },
  userNotes:    { type: String },
  appliedAt:    { type: Date },
  rejectedAt:   { type: Date }
}, {
  timestamps: true
});

// One job per brand per rest_id (legacy) and per dedupeKey (same listing)
twitterJobSchema.index({ brandId: 1, rest_id: 1 }, { unique: true, sparse: true });
twitterJobSchema.index({ brandId: 1, dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('TwitterJob', twitterJobSchema);