const mongoose = require('mongoose');

const bounceEmailSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand' },
  smtpAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmtpAccount' },
  from: { type: String },
  subject: { type: String },
  receivedAt: { type: Date },
  type: {
    type: String,
    enum: ['bounce', 'reply', 'auto_reply', 'other']
  },
  rawSnippet: { type: String },
  contactEmail: { type: String },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  processed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BounceEmail', bounceEmailSchema);
