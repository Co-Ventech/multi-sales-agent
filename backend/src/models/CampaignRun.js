const mongoose = require('mongoose');

const logEntrySchema = new mongoose.Schema({
  time: { type: Date, default: Date.now },
  level: { type: String },
  message: { type: String }
}, { _id: false });

const campaignRunSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  action: { type: String }, // "send" | "import" | "follow-ups" | "check-bounces" | "full" | "dry-run"
  status: {
    type: String,
    enum: ['running', 'completed', 'failed'],
    default: 'running'
  },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  results: {
    imported: { type: Number, default: 0 },
    generated: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    spamBlocked: { type: Number, default: 0 },
    bounces: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    scraped: { type: Number, default: 0 },
    jobsFilteredOut: { type: Number, default: 0 },
    jobsKept: { type: Number, default: 0 },
    jobsCapDropped: { type: Number, default: 0 },
    companiesMatched: { type: Number, default: 0 },
    jobsStored: { type: Number, default: 0 },
    employeesFound: { type: Number, default: 0 },
    contactsCreated: { type: Number, default: 0 },
    followUpsSent: { type: Number, default: 0 }
  },
  logs: [logEntrySchema],
  error: { type: String }
});

campaignRunSchema.index({ brandId: 1, startedAt: -1 });

module.exports = mongoose.model('CampaignRun', campaignRunSchema);
