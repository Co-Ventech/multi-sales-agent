const CampaignRun = require('../models/CampaignRun');
const Brand = require('../models/Brand');
const Contact = require('../models/Contact');
const importPhase = require('./importPhase');
const generatePhase = require('./generatePhase');
const sendPhase = require('./sendPhase');
const bounceCheckPhase = require('./bounceCheckPhase');
const followUpPhase = require('./followUpPhase');
const scrapeLeadsPhase = require('./scrapeLeadsPhase');
const scrapeLinkedInPhase = require('./scrapeLinkedInPhase');
const scrapeUpworkPhase = require('./scrapeUpworkPhase');
const blogPipelinePhase = require('./blogPipelinePhase');
const { syncStatusToSheet } = require('../services/sheetsBiSync');

// Create a run-scoped logger that writes to CampaignRun.logs
function createRunLogger(runDoc) {
  const log = (level, message) => {
    const now = new Date();
    const entry = { time: now, level, message };
    // Fire and forget — we don't await to avoid blocking
    CampaignRun.findByIdAndUpdate(runDoc._id, { $push: { logs: entry } }).catch(() => {});
    console.log(`${now.toISOString()} [${level.toUpperCase()}] [Run:${runDoc._id}] ${message}`);
  };

  return {
    info:  (m) => log('info', m),
    warn:  (m) => log('warn', m),
    error: (m) => log('error', m),
    debug: (m) => log('debug', m),
    sync:  (m) => log('info', m)
  };
}

async function run(brandId, action, opts = {}) {
  // If caller already created the run doc, use it; otherwise create new
  let runDoc;

  if (opts._existingRunId) {
    runDoc = await CampaignRun.findById(opts._existingRunId);
    if (!runDoc) {
      throw new Error('Run document not found');
    }
  } else {
    // Check for already-running
    const existing = await CampaignRun.findOne({ brandId, status: 'running' });
    if (existing) throw new Error('Pipeline already running for this brand');

    runDoc = await CampaignRun.create({
      brandId,
      action,
      status: 'running',
      startedAt: new Date()
    });
  }

  const brand = await Brand.findById(brandId);
  if (!brand) {
    await CampaignRun.findByIdAndUpdate(runDoc._id, {
      status: 'failed',
      completedAt: new Date(),
      error: 'Brand not found'
    });
    throw new Error('Brand not found');
  }

  const logger = createRunLogger(runDoc);
  const results = {
    imported: 0, generated: 0, sent: 0, failed: 0, spamBlocked: 0, bounces: 0, replies: 0,
    scraped: 0, followUpsSent: 0,
    companiesMatched: 0, jobsStored: 0, employeesFound: 0, contactsCreated: 0,
    jobsFilteredOut: 0, jobsKept: 0, jobsCapDropped: 0
  };

  try {
    logger.info(`=== Pipeline start: ${action} [brand: ${brand.name}] ===`);

    const isDryRun = action === 'dry-run';

    if (action === 'import') {
      results.imported = await importPhase(brand, logger, opts);

    } else if (action === 'generate') {
      const r = await generatePhase(brand, logger, opts);
      results.generated = r.generated;
      results.failed = r.failed;

    } else if (action === 'send' || action === 'dry-run') {
      const r = await sendPhase(brand, logger, { ...opts, dryRun: isDryRun });
      results.sent = r.sent;
      results.failed = r.failed;
      results.spamBlocked = r.spamBlocked;

    } else if (action === 'check-bounces') {
      const r = await bounceCheckPhase(brand, logger, opts);
      results.bounces = r.bounces;
      results.replies = r.replies;

    } else if (action === 'follow-ups') {
      const r = await followUpPhase(brand, logger, opts);
      results.followUpsSent = r.sent;

    } else if (action === 'scrape-leads') {
      const r = await scrapeLeadsPhase(brand, logger, opts);
      results.scraped = r.scraped;
      results.imported = r.imported;

    } else if (action === 'scrape-linkedin') {
      const r = await scrapeLinkedInPhase(brand, logger, opts);
      results.scraped = r.rawJobs;
      results.companiesMatched = r.companiesMatched;
      results.jobsStored = r.jobsStored;
      results.employeesFound = r.employeesFound;
      results.contactsCreated = r.contactsCreated;
      results.jobsFilteredOut = r.jobsFilteredOut || 0;
      results.jobsKept = r.jobsKept || 0;
      results.jobsCapDropped = r.jobsCapDropped || 0;

    } else if (action === 'scrape-upwork') {
      const r = await scrapeUpworkPhase(brand, logger, opts);
      results.scraped = r.rawJobs;
      results.jobsStored = r.jobsStored;
      results.companiesMatched = r.companiesMatched;
      results.contactsCreated = r.contactsCreated;
      results.employeesFound = r.employeesFound;

    } else if (action === 'blog-pipeline') {
      const r = await blogPipelinePhase(brand, logger, opts);
      results.runId = r.runId;
      results.topic = r.topic;
      results.status = r.status;

    } else if (action === 'full') {
      results.imported = await importPhase(brand, logger, opts);
      const g = await generatePhase(brand, logger, opts);
      results.generated = g.generated;
      results.failed += g.failed;
      const s = await sendPhase(brand, logger, opts);
      results.sent = s.sent;
      results.failed += s.failed;
      results.spamBlocked = s.spamBlocked;
    }

    logger.info(`=== Pipeline complete: ${JSON.stringify(results)} ===`);

    // Auto-sync contact statuses back to Google Sheet (non-blocking)
    if (brand.googleSheets?.enabled && brand.googleSheets?.spreadsheetId &&
        ['send', 'check-bounces', 'full'].includes(action)) {
      Contact.find({ brandId: brand._id }).lean()
        .then(contacts => syncStatusToSheet(brand, contacts, logger))
        .catch(err => logger.warn(`Sheet sync failed: ${err.message}`));
    }

    await CampaignRun.findByIdAndUpdate(runDoc._id, {
      status: 'completed',
      completedAt: new Date(),
      results
    });

  } catch (err) {
    logger.error(`Pipeline error: ${err.message}`);
    await CampaignRun.findByIdAndUpdate(runDoc._id, {
      status: 'failed',
      completedAt: new Date(),
      results,
      error: err.message
    });
  }

  return results;
}

module.exports = { run };
