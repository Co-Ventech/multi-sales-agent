/**
 * LinkedinContact.js — Stores LinkedIn employee contacts, each linked to all jobs at their company.
 * Separate from Contact so other brands are unaffected.
 */

const mongoose = require('mongoose');

const linkedinContactSchema = new mongoose.Schema({
  brandId:         { type: mongoose.Schema.Types.ObjectId, required: true },

  // Employee data (from employee actor)
  email:           { type: String, required: true },
  firstName:       { type: String },
  lastName:        { type: String },
  fullName:        { type: String },
  jobTitle:        { type: String },
  headline:        { type: String },
  linkedinUrl:     { type: String },

  // Company this employee belongs to
  companyName:     { type: String },
  companyLinkedin: { type: String },   // normalized LinkedIn company URL
  industry:        { type: String },
  companySize:     { type: String },
  companyWebsite:  { type: String },

  // Location
  city:             { type: String },
  state:           { type: String },
  country:         { type: String },

  // All jobs at this company that got enriched with this contact's email
  linkedinJobIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'LinkedinJob' }],

  // Status
  status:          { type: String, default: 'Pending' }
}, {
  timestamps: true
});

// Unique email per brand
linkedinContactSchema.index({ brandId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('LinkedinContact', linkedinContactSchema);