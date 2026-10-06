const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand' },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  smtpAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmtpAccount' },
  type: {
    type: String,
    enum: ['initial', 'followup_1', 'followup_2', 'followup_3'],
    default: 'initial'
  },
  abVariant: { type: String },
  subject: { type: String },
  body: { type: String },
  to: { type: String },
  from: { type: String },
  status: {
    type: String,
    enum: ['sent', 'failed', 'bounced'],
    default: 'sent'
  },
  messageId: { type: String },
  smtpResponse: { type: String },
  sentAt: { type: Date, default: Date.now },
  errorMessage: { type: String }
});

emailLogSchema.index({ brandId: 1, sentAt: -1 });
emailLogSchema.index({ contactId: 1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
