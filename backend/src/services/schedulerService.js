const cron = require('node-cron');
const Brand = require('../models/Brand');
const runner = require('../pipeline/runner');

// Map of brandId (string) -> { send, followups, bounces }
const activeCrons = new Map();

async function initAll() {
  // Recover stale "running" CampaignRun docs left over from a crash/restart.
  // Without this, the per-brand lock (CampaignRun.findOne({status:'running'})) rejects
  // every future scheduled run because the DB row was never marked failed/completed.
  try {
    const CampaignRun = require('../models/CampaignRun');
    const stale = await CampaignRun.updateMany(
      { status: 'running' },
      { status: 'failed', completedAt: new Date(), error: 'Recovered on startup — process was restarted while run was in progress' }
    );
    if (stale.modifiedCount > 0) {
      console.warn(`[Scheduler] Recovered ${stale.modifiedCount} stale 'running' run(s) from prior restart`);
    }
  } catch (err) {
    console.error('[Scheduler] Stale run recovery failed:', err.message);
  }

  // Recover stale BlogPipelineRun docs (e.g. old /suggest flow or killed mid-draft)
  try {
    const BlogPipelineRun = require('../models/BlogPipelineRun');
    const staleBlog = await BlogPipelineRun.updateMany(
      { status: { $in: ['running', 'pending'] } },
      { status: 'failed', error: 'Recovered on startup — process was restarted while run was in progress' }
    );
    if (staleBlog.modifiedCount > 0) {
      console.warn(`[Scheduler] Recovered ${staleBlog.modifiedCount} stale blog pipeline run(s) from prior restart`);
    }
  } catch (err) {
    console.error('[Scheduler] Stale blog pipeline recovery failed:', err.message);
  }

  // Retry up to 3 times in case of transient DB issues at startup
  let brands = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      brands = await Brand.find({ isActive: true, 'cron.enabled': true });
      break;
    } catch (err) {
      console.error(`[Scheduler] DB query failed (attempt ${attempt}/3): ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }

  if (brands.length === 0) {
    console.warn('[Scheduler] No active brands with cron enabled — check isActive and cron.enabled fields in DB');
  }

  console.log(`[Scheduler] Initializing ${brands.length} brand schedule(s)`);
  for (const brand of brands) {
    scheduleBrand(brand);
  }
}

// Run a pipeline action with automatic retry-on-lock.
// If the lock is held by a same-brand pipeline (e.g. bounce check fired at the
// same minute), wait up to 3 minutes (6 retries x 30s) before giving up.
// Without this, simultaneous cron triggers cause silent dropped runs.
async function runWithRetry(brandId, brandName, action, opts = {}) {
  const MAX_RETRIES = 6;
  const RETRY_DELAY_MS = 30 * 1000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await runner.run(brandId, action, opts);
      return;
    } catch (err) {
      const isLock = /already running for this brand/i.test(err.message || '');
      if (!isLock || attempt >= MAX_RETRIES) {
        console.error(`[Scheduler] ${action} error (${brandName}): ${err.message}`);
        return;
      }
      console.warn(`[Scheduler] ${action} (${brandName}) blocked by lock — retry ${attempt + 1}/${MAX_RETRIES} in 30s`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

function scheduleBrand(brand) {
  // Cancel existing jobs for this brand
  cancelBrand(brand._id.toString());

  const tz = brand.cron?.timezone || 'America/New_York';                  // recipient tz (sends, follow-ups, bounces)
  const scrapeTz = brand.cron?.scrapeTimezone || tz;                      // operator tz (scrape only)
  const jobs = {};

  if (brand.cron?.generateEmails) {
    try {
      jobs.generate = cron.schedule(brand.cron.generateEmails, () => {
        console.log(`[Scheduler] Running generate for brand: ${brand.name}`);
        runWithRetry(brand._id, brand.name, 'generate');
      }, { timezone: tz, scheduled: true });
      console.log(`[Scheduler] Scheduled generate for ${brand.name}: ${brand.cron.generateEmails} (${tz})`);
    } catch (err) {
      console.error(`[Scheduler] Invalid generate cron for ${brand.name}:`, err.message);
    }
  }

  if (brand.cron?.sendEmails) {
    try {
      jobs.send = cron.schedule(brand.cron.sendEmails, () => {
        console.log(`[Scheduler] Running send for brand: ${brand.name}`);
        runWithRetry(brand._id, brand.name, 'send');
      }, { timezone: tz, scheduled: true });
      console.log(`[Scheduler] Scheduled send for ${brand.name}: ${brand.cron.sendEmails} (${tz})`);
    } catch (err) {
      console.error(`[Scheduler] Invalid send cron for ${brand.name}:`, err.message);
    }
  }

  if (brand.cron?.scrapeLeads) {
    try {
      jobs.scrape = cron.schedule(brand.cron.scrapeLeads, () => {
        console.log(`[Scheduler] Running scrape-leads for brand: ${brand.name}`);
        runWithRetry(brand._id, brand.name, 'scrape-leads');
      }, { timezone: scrapeTz, scheduled: true });
      console.log(`[Scheduler] Scheduled scrape-leads for ${brand.name}: ${brand.cron.scrapeLeads} (${scrapeTz})`);
    } catch (err) {
      console.error(`[Scheduler] Invalid scrapeLeads cron for ${brand.name}:`, err.message);
    }
  }

  if (brand.cron?.scrapeLinkedin) {
    try {
      jobs.scrapeLinkedin = cron.schedule(brand.cron.scrapeLinkedin, () => {
        console.log(`[Scheduler] Running scrape-linkedin for brand: ${brand.name}`);
        runWithRetry(brand._id, brand.name, 'scrape-linkedin');
      }, { timezone: scrapeTz, scheduled: true });
      console.log(`[Scheduler] Scheduled scrape-linkedin for ${brand.name}: ${brand.cron.scrapeLinkedin} (${scrapeTz})`);
    } catch (err) {
      console.error(`[Scheduler] Invalid scrapeLinkedin cron for ${brand.name}:`, err.message);
    }
  }

  if (brand.cron?.sendFollowups) {
    try {
      jobs.followups = cron.schedule(brand.cron.sendFollowups, () => {
        console.log(`[Scheduler] Running follow-ups for brand: ${brand.name}`);
        runWithRetry(brand._id, brand.name, 'follow-ups');
      }, { timezone: tz, scheduled: true });
      console.log(`[Scheduler] Scheduled follow-ups for ${brand.name}: ${brand.cron.sendFollowups} (${tz})`);
    } catch (err) {
      console.error(`[Scheduler] Invalid sendFollowups cron for ${brand.name}:`, err.message);
    }
  }

  if (brand.cron?.checkBounces) {
    try {
      jobs.bounces = cron.schedule(brand.cron.checkBounces, () => {
        console.log(`[Scheduler] Running bounce check for brand: ${brand.name}`);
        // Bounce check runs every 15 min, so don't retry-on-lock — next tick will fire soon enough.
        runner.run(brand._id, 'check-bounces', {}).catch(err => {
          if (!/already running for this brand/i.test(err.message || '')) {
            console.error(`[Scheduler] Bounce check error (${brand.name}):`, err.message);
          }
        });
      }, { timezone: tz, scheduled: true });
      console.log(`[Scheduler] Scheduled bounce check for ${brand.name}: ${brand.cron.checkBounces} (${tz})`);
    } catch (err) {
      console.error(`[Scheduler] Invalid bounces cron for ${brand.name}:`, err.message);
    }
  }

  if (Object.keys(jobs).length > 0) {
    activeCrons.set(brand._id.toString(), jobs);
  }
}

function cancelBrand(brandId) {
  const jobs = activeCrons.get(brandId);
  if (jobs) {
    Object.values(jobs).forEach(j => {
      try { j.stop(); } catch {}
    });
    activeCrons.delete(brandId);
    console.log(`[Scheduler] Cancelled schedules for brand: ${brandId}`);
  }
}

function getActiveBrands() {
  return [...activeCrons.keys()];
}

module.exports = { initAll, scheduleBrand, cancelBrand, getActiveBrands };
