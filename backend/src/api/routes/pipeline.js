const express = require('express');
const multer = require('multer');
const CampaignRun = require('../../models/CampaignRun');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const runner = require('../../pipeline/runner');

const router = express.Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(requireAuth);

// POST /api/brands/:brandId/pipeline/run
router.post('/run', upload.single('file'), asyncHandler(async (req, res) => {
  const brandId = req.params.brandId;
  const { action, limit } = req.body;

  const validActions = ['send', 'import', 'follow-ups', 'check-bounces', 'full', 'dry-run', 'generate', 'scrape-leads', 'scrape-linkedin', 'scrape-upwork'];
  if (!action || !validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
  }

  // Check if already running
  const existing = await CampaignRun.findOne({ brandId, status: 'running' });
  if (existing) {
    return res.status(409).json({ error: 'Pipeline already running for this brand', runId: existing._id });
  }

  const opts = {};
  if (limit) opts.limit = parseInt(limit);

  // Handle file upload for import action
  if (action === 'import' && req.file) {
    try {
      opts.leads = JSON.parse(req.file.buffer.toString('utf8'));
    } catch (err) {
      return res.status(400).json({ error: `Invalid JSON file: ${err.message}` });
    }
  }

  // Create run record first
  const runDoc = await CampaignRun.create({
    brandId,
    action,
    status: 'running',
    startedAt: new Date()
  });

  // Run pipeline in background
  runner.run(brandId, action, { ...opts, _existingRunId: runDoc._id }).catch(err => {
    console.error('[Pipeline] Background error:', err.message);
    CampaignRun.findByIdAndUpdate(runDoc._id, {
      status: 'failed',
      completedAt: new Date(),
      error: err.message
    }).catch(() => {});
  });

  return res.json({ runId: runDoc._id, status: 'running' });
}));

// GET /api/brands/:brandId/pipeline/status
router.get('/status', asyncHandler(async (req, res) => {
  const brandId = req.params.brandId;

  // Get current running or last completed
  const run = await CampaignRun.findOne({ brandId })
    .sort({ startedAt: -1 })
    .select('-logs'); // exclude logs for performance

  return res.json(run || null);
}));

// GET /api/brands/:brandId/pipeline/logs/:runId — SSE
router.get('/logs/:runId', requireAuth, async (req, res) => {
  const { runId } = req.params;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.flushHeaders();

  let lastLogIndex = 0;
  let intervalId = null;

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const poll = async () => {
    try {
      const run = await CampaignRun.findById(runId);
      if (!run) {
        sendEvent({ type: 'error', message: 'Run not found' });
        cleanup();
        return;
      }

      // Send any new log entries
      if (run.logs && run.logs.length > lastLogIndex) {
        const newLogs = run.logs.slice(lastLogIndex);
        for (const log of newLogs) {
          sendEvent({ type: 'log', ...log });
        }
        lastLogIndex = run.logs.length;
      }

      // If run is done, send final status and close
      if (run.status !== 'running') {
        sendEvent({
          type: 'complete',
          runId: run._id,
          status: run.status,
          results: run.results,
          error: run.error
        });
        cleanup();
      }
    } catch (err) {
      sendEvent({ type: 'error', message: err.message });
      cleanup();
    }
  };

  const cleanup = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    res.end();
  };

  // Poll every 1500ms
  intervalId = setInterval(poll, 1500);

  // Initial poll immediately
  await poll();

  // Clean up if client disconnects
  req.on('close', cleanup);
  req.on('error', cleanup);
});

// POST /api/brands/:brandId/pipeline/stop — force-stop a running pipeline
router.post('/stop', asyncHandler(async (req, res) => {
  const run = await CampaignRun.findOne({ brandId: req.params.brandId, status: 'running' });
  if (!run) return res.status(404).json({ error: 'No running pipeline' });

  await CampaignRun.findByIdAndUpdate(run._id, {
    status: 'failed',
    completedAt: new Date(),
    error: 'Stopped manually'
  });

  return res.json({ ok: true, message: 'Pipeline marked as stopped' });
}));

// GET /api/brands/:brandId/pipeline/history
router.get('/history', asyncHandler(async (req, res) => {
  const runs = await CampaignRun.find({ brandId: req.params.brandId })
    .sort({ startedAt: -1 })
    .limit(20)
    .select('-logs'); // exclude verbose logs from history list

  return res.json(runs);
}));

module.exports = router;
