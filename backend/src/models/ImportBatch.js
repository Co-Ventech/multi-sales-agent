const mongoose = require('mongoose');

const importBatchSchema = new mongoose.Schema({
  brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true, index: true },
  name: { type: String, required: true },          // e.g. "leads-batch-3.json" or "Apify scrape 2026-05-08 14:00"
  source: { type: String, default: 'json_upload' },// json_upload | csv_upload | google_sheet | apify_scrape | manual
  count: { type: Number, default: 0 },             // contacts inserted in this batch
  paused: { type: Boolean, default: false, index: true }, // when true, send phase skips these contacts
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ImportBatch', importBatchSchema);
