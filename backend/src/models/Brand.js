const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, lowercase: true },
  description: { type: String },
  website: { type: String },

  company: {
    name: { type: String },
    description: { type: String },
    website: { type: String }
  },

  openai: {
    systemPrompt: { type: String },
    model: { type: String, default: 'gpt-4o' },
    temperature: { type: Number, default: 0.75 },
    maxTokens: { type: Number, default: 400 }
  },

  abTest: {
    enabled: { type: Boolean, default: false },
    promptA: { type: String },
    promptB: { type: String }
  },

  campaign: {
    tone: { type: String, default: 'professional' },
    cta: { type: String, default: 'Worth a 15-minute call?' },
    valueProp: { type: String },
    calendlyUrl: { type: String },
    dailyLimit: { type: Number, default: 20 },
    delayMinSec: { type: Number, default: 8 },
    delayMaxSec: { type: Number, default: 20 },
    followUpDays: { type: [Number], default: [3] },
    followUpPrompt: { type: String },
    followUpsEnabled: { type: Boolean, default: true },  // master toggle for follow-up sending
    timezoneFilter: { type: Boolean, default: true },
    spamFilter: { type: Boolean, default: true }
  },

  qualification: {
    threshold: { type: Number, default: 6 },
    industryFilter: [{ type: String }]
  },

  googleSheets: {
    enabled: { type: Boolean, default: false },
    spreadsheetId: { type: String },
    worksheetName: { type: String, default: 'Master' }
  },

  cron: {
    sendEmails: { type: String, default: '0 9 * * 1-5' },
    generateEmails: { type: String },
    sendFollowups: { type: String, default: '0 13 * * 1-5' },
    checkBounces: { type: String, default: '0 8 * * *' },
    scrapeLeads: { type: String },
    scrapeLinkedin: { type: String },
    scrapeUpwork: { type: String },
    timezone: { type: String, default: 'America/New_York' },           // recipient timezone (sends, follow-ups, bounces)
    scrapeTimezone: { type: String, default: 'Asia/Karachi' },         // operator timezone (lead scraping cron only)
    enabled: { type: Boolean, default: false }
  },

  slack: {
    enabled: { type: Boolean, default: false },
    webhookUrl: { type: String },
    notifyOnReply: { type: Boolean, default: true },
    notifyOnBounce: { type: Boolean, default: false }
  },

  notifications: {
    replyNotifyEmail: { type: String },   // email address to notify on reply
    bounceNotifyEmail: { type: String },  // email address to notify on bounce
  },

  apify: {
    apiToken: { type: String },  // optional per-brand override; prefer APIFY_API_TOKEN in .env
    actorId: { type: String, default: 'IoSHqwTR9YGhzccez' },  // default actor
    defaultInput: { type: mongoose.Schema.Types.Mixed, default: {} },  // saved filter preset
    fetchCount: { type: Number, default: 100 },  // override for defaultInput.fetch_count from Settings UI
    linkedinJobsDefaultInput: { type: mongoose.Schema.Types.Mixed, default: {} },  // LinkedIn jobs filter preset
    linkedinEmployeesDefaultInput: { type: mongoose.Schema.Types.Mixed, default: {} },  // LinkedIn employees filter preset
    provider: { type: String, enum: ['apify', 'mcp'], default: 'apify' },  // scraping engine: apify (default) | mcp
    mcpConfig: { type: mongoose.Schema.Types.Mixed, default: {} }  // optional { url, token } overrides for Upwork MCP
  },

  twitterJobs: {
    enabled:  { type: Boolean, default: true },
    apiToken: { type: String },
    actorId:   { type: String, default: 'powerai~twitter-jobs-search-scraper' }
  },

  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

// Auto-generate slug from name before saving if not set
brandSchema.pre('validate', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
  next();
});

module.exports = mongoose.model('Brand', brandSchema);
