const mongoose = require('mongoose');

const smtpDailyCountSchema = new mongoose.Schema({
  smtpAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmtpAccount', required: true },
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  date: { type: String, required: true }, // "YYYY-MM-DD"
  count: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

// Unique compound index to prevent duplicate daily records per SMTP account
smtpDailyCountSchema.index({ smtpAccountId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('SmtpDailyCount', smtpDailyCountSchema);
