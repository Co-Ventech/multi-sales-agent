const mongoose = require('mongoose');

const smtpAccountSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  host: { type: String, required: true },
  port: { type: Number, default: 587 },
  username: { type: String, required: true },
  passwordEncrypted: { type: String, required: true },
  fromEmail: { type: String, required: true },
  fromName: { type: String },
  replyTo: { type: String },
  senderName: { type: String },
  senderPosition: { type: String, default: 'Business Development' },
  senderWebsite: { type: String },
  senderPhone: { type: String },
  useTLS: { type: Boolean, default: true },
  useSSL: { type: Boolean, default: false },
  dailyLimit: { type: Number, default: 10 },
  warmupStartDate: { type: Date, default: null },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('SmtpAccount', smtpAccountSchema);
