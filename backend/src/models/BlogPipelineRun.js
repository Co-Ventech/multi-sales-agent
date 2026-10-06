const mongoose = require('mongoose');

const blogPipelineRunSchema = new mongoose.Schema({
  brandId: { type: String, required: true },

  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'approved', 'published', 'rejected'],
    default: 'pending'
  },

  // Pipeline step tracking
  steps: {
    trends: { status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' }, found: Number },
    keywordFilter: { status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' }, candidates: Number, picked: String },
    topicScoring: { status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' }, picked: String },
    serp: { status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' }, organic: Number },
    draft: { status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' }, wordEstimate: Number },
    heroImage: { status: { type: String, enum: ['pending', 'done', 'skipped', 'failed'], default: 'pending' }, path: String },
    sectionImages: { status: { type: String, enum: ['pending', 'done', 'skipped', 'failed'], default: 'pending' }, count: Number },
    seoApproval: { status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' }, score: Number, approved: Boolean }
  },

  // Topic that was picked
  topic: {
    phrase: String,
    intent: String,
    gapScore: Number,
    sourceSeed: String
  },

  // SEO Audit result
  seoAudit: {
    score: Number,
    approved: Boolean,
    checks: mongoose.Schema.Types.Mixed,
    wordCount: Number,
    readability: String,
    issues: [String],
    suggestions: [String]
  },

  // Draft data
  draft: {
    seoTitle: String,
    metaDescription: String,
    h1: String,
    authorTagline: String,
    methodologyNote: String,
    pullQuote: String,
    sections: mongoose.Schema.Types.Mixed,
    faq: mongoose.Schema.Types.Mixed,
    sources: mongoose.Schema.Types.Mixed,
    relatedReading: mongoose.Schema.Types.Mixed,
    heroImage: mongoose.Schema.Types.Mixed,
    sectionImages: [mongoose.Schema.Types.Mixed],
    bodyMarkdown: String
  },

  // File paths
  artifacts: {
    trendsPath: String,
    serpPath: String,
    draftPath: String
  },

  // Error if failed
  error: String,

  // Country used
  countryCode: { type: String, default: 'US' },

  // SEO score threshold for approval
  seoScoreThreshold: { type: Number, default: 70 },

  // Time range for trends (natural language for MiniMax: "today", "this week", "this month")
  timeRange: { type: String, default: 'this week' },

  // Search terms for trends discovery
  searchTerms: { type: String, default: 'AI agents DevOps, LLM integration patterns, autonomous AI QA, AI security testing, DevOps automation guide, QA automation best practices' },

  // Live pipeline logs
  logs: [{ type: String }]
}, {
  timestamps: true
});

module.exports = mongoose.model('BlogPipelineRun', blogPipelineRunSchema);