const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  num: Number,
  subject: String,
  body: String,
  sentAt: Date,
  smtpAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmtpAccount' }
}, { _id: false });

const contactSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  email: { type: String, required: true, trim: true, lowercase: true },

  // Identity
  firstName: { type: String },
  lastName: { type: String },
  fullName: { type: String },
  linkedinUrl: { type: String },
  /** LinkedIn job posting URL (separate from HR profile in linkedinUrl). */
  jobLinkedinUrl: { type: String },
  mobileNumber: { type: String },

  // Role
  jobTitle: { type: String },
  headline: { type: String },
  seniorityLevel: { type: String },
  functionalLevel: { type: String },
  emailStatus: { type: String },

  // Company
  companyName: { type: String },
  companyDomain: { type: String },
  companyWebsite: { type: String },
  industry: { type: String },
  companySize: { type: String },
  companyDescription: { type: String },
  companyAnnualRevenue: { type: String },
  companyTotalFunding: { type: String },
  companyPhone: { type: String },
  companyLinkedin: { type: String },

  // Location
  city: { type: String },
  state: { type: String },
  country: { type: String },

  // Scoring
  leadScore: { type: Number },
  scoreBreakdown: { type: mongoose.Schema.Types.Mixed },
  technologyStack: [{ type: String }],

  // Campaign
  status: {
    type: String,
    enum: ['Pending', 'Generated', 'Sent', 'Failed', 'Bounced', 'Replied', 'Unsubscribed', 'SpamBlocked', 'DryRun'],
    default: 'Pending'
  },
  abVariant: { type: String, enum: ['A', 'B', null], default: null },
  emailSubject: { type: String },
  generatedEmailContent: { type: String },
  dateSent: { type: Date },
  dateReplied: { type: Date },
  dateBounced: { type: Date },
  sentFrom: { type: String },
  smtpAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmtpAccount' },
  followUps: [followUpSchema],
  retryAttempts: { type: Number, default: 0 },
  errorMessage: { type: String },
  replyContent: { type: String },
  bounceReason: { type: String },
  trackingUid: { type: String, unique: true, sparse: true },
  calendlyClicked: { type: Boolean, default: false },
  clickDate: { type: Date },
  notes: { type: String },
  importSource: { type: String, default: 'json_upload' },

  // LinkedIn enrichment — reference to the LinkedinContact that owns the email
  // Allows frontend to fetch all LinkedIn jobs for this contact
  linkedinContactId: { type: mongoose.Schema.Types.ObjectId, ref: 'LinkedinContact' },

  // LinkedIn job IDs — each Contact is paired with ONE specific job
  // Multiple contacts can reference the same job (different HR emails for same job)
  linkedinJobIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LinkedinJob' }],

  // Upwork job IDs — same pattern as linkedinJobIds but for Upwork jobs
  upworkJobIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UpworkJob' }],

  importBatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', index: true }
}, {
  timestamps: true
});

// Compound unique index: one contact per brand per email per job
contactSchema.index({ brandId: 1, email: 1, linkedinUrl: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);
