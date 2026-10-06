const express = require('express');
const fs = require('fs');
const path = require('path');
const BlogPipelineRun = require('../../models/BlogPipelineRun');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { postBlog } = require('../../agents/marketing/post');
const { adaptDraftForApproval } = require('../../agents/marketing/application/draftForApproval');

const router = express.Router();

/** Always backend/data/runs (not dependent on process.cwd()). */
const BLOG_RUNS_DIR = path.resolve(__dirname, '../../../data/runs');

function safeRunsFilePath(filename) {
  const base = path.basename(String(filename || '').replace(/\\/g, '/'));
  if (!base || base.includes('..')) return null;
  const absPath = path.resolve(BLOG_RUNS_DIR, base);
  const runsResolved = path.resolve(BLOG_RUNS_DIR);
  const rel = path.relative(runsResolved, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return absPath;
}

function pipelineRunIdFromArtifacts(run) {
  const sources = [
    run?.draft?.heroImage?.relativePath,
    run?.draft?.heroImage?.filename,
    run?.steps?.heroImage?.path,
    run?.artifacts?.draftPath
  ];
  for (const s of sources) {
    const m = String(s || '').replace(/\\/g, '/').match(/(\d{13,}-[a-z0-9]+)/i);
    if (m) return m[1];
  }
  return null;
}

function sendRunsImage(res, filename) {
  const absPath = safeRunsFilePath(filename);
  if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.type(path.extname(absPath) || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(absPath);
}

/** Serve generated hero/section PNGs for dashboard preview (files in data/runs only). */
router.get('/files/:filename', asyncHandler(async (req, res) => {
  const filename = path.basename(String(req.params.filename || ''));
  if (!filename) return res.status(400).json({ error: 'Missing filename' });
  return sendRunsImage(res, filename);
}));

async function sendHeroForRun(res, run) {
  const hi = run.draft?.heroImage;
  const fromMeta = hi?.filename || (hi?.relativePath && path.basename(String(hi.relativePath)));
  if (fromMeta) {
    const abs = safeRunsFilePath(fromMeta);
    if (abs && fs.existsSync(abs)) return sendRunsImage(res, fromMeta);
  }
  const fromStep = run.steps?.heroImage?.path && path.basename(String(run.steps.heroImage.path));
  if (fromStep) {
    const abs = safeRunsFilePath(fromStep);
    if (abs && fs.existsSync(abs)) return sendRunsImage(res, fromStep);
  }
  const runId = pipelineRunIdFromArtifacts(run);
  if (runId) return sendRunsImage(res, `${runId}-hero.png`);
  return res.status(404).json({ error: 'Hero image not found' });
}

/** Resolve hero image by Mongo run id (fallback when relativePath missing). */
router.get('/runs/:id/images/hero', asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findById(req.params.id).lean();
  if (!run) return res.status(404).json({ error: 'Run not found' });
  return sendHeroForRun(res, run);
}));

router.get('/runs/:id/images/section-:index', asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findById(req.params.id).lean();
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const idx = Number(req.params.index);
  const sectionImages = Array.isArray(run.draft?.sectionImages) ? run.draft.sectionImages : [];
  const img = sectionImages[idx - 1];
  if (img?.filename || img?.relativePath) {
    const name = img.filename || path.basename(String(img.relativePath));
    const abs = safeRunsFilePath(name);
    if (abs && fs.existsSync(abs)) return sendRunsImage(res, name);
  }
  const runId = pipelineRunIdFromArtifacts(run);
  if (runId && idx >= 1) return sendRunsImage(res, `${runId}-section-${idx}.png`);
  return res.status(404).json({ error: 'Section image not found' });
}));

/** In-memory suggest jobs — POST returns immediately; client polls GET /suggest/jobs/:jobId */
const suggestJobs = new Map();
const SUGGEST_JOB_TTL_MS = 60 * 60 * 1000;

function pruneSuggestJobs() {
  const now = Date.now();
  for (const [id, job] of suggestJobs) {
    if (now - (job.createdAt || 0) > SUGGEST_JOB_TTL_MS) suggestJobs.delete(id);
  }
}

function buildSuggestPayload(result) {
  const candidates = (result.winners || []).map(w => ({
    phrase: w.phrase || '',
    intent: w.intent || 'INFORMATIONAL',
    gapScore: w.gapScore || 0,
    recentOrganicCount: w.recentOrganicCount || 0,
    relatedRichness: w.relatedRichness || 0,
    signal_value: w.signal_value || 0,
    sourceSeed: w.source_seed || '',
    grade: w.grade || null
  }));

  const picked = result.picked ? {
    phrase: result.picked.phrase || '',
    intent: result.picked.intent || 'INFORMATIONAL',
    gapScore: result.picked.gapScore || 0,
    sourceSeed: result.picked.source_seed || ''
  } : null;

  return { candidates, picked, reasoning: result.reasoning || null, allRankedCount: result.allRankedCount || 0 };
}

// GET routes are public (no auth needed for blog dashboard)
router.get('/runs', asyncHandler(async (req, res) => {
  const runs = await BlogPipelineRun.find({})
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return res.json(runs);
}));

// POST /api/blog-pipeline/suggest — start async job (steps 1-3), return jobId immediately (no auth)
router.post('/suggest', asyncHandler(async (req, res) => {
  const { countryCode, timeRange, searchTerms } = req.body;

  // Apply fallbacks for empty inputs
  const effectiveCountry = countryCode || 'United States';
  const effectiveSearchTerms = searchTerms || 'AI agents, MLOps, LLM applications, RAG systems, prompt engineering, AI infrastructure, vector databases';

  pruneSuggestJobs();

  const jobId = `suggest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  suggestJobs.set(jobId, { status: 'running', createdAt: Date.now() });

  console.log('[Suggest] request body:', JSON.stringify(req.body));
  console.log(`[Suggest] effective: country="${effectiveCountry}" | searchTerms="${effectiveSearchTerms}"`);
  console.log(`[Suggest] job started: ${jobId}`);

  res.json({ jobId, status: 'running' });

  setImmediate(async () => {
    try {
      const { suggestTopics } = require('../../agents/marketing/application/seoBlogPipeline');
      const result = await suggestTopics({
        countryCode: effectiveCountry,
        searchTermsOverride: effectiveSearchTerms,
        timeRangeOverride: timeRange
      });

      console.log('[Suggest] result.winners count:', (result.winners || []).length);
      console.log('[Suggest] result.picked:', result.picked?.phrase);

      const payload = buildSuggestPayload(result);
      suggestJobs.set(jobId, {
        status: 'done',
        createdAt: suggestJobs.get(jobId)?.createdAt || Date.now(),
        ...payload
      });
      console.log(`[Suggest] job done: ${jobId} | candidates=${payload.candidates.length}`);
    } catch (err) {
      console.error(`[Suggest] job failed: ${jobId}`, err.message);
      suggestJobs.set(jobId, {
        status: 'failed',
        createdAt: suggestJobs.get(jobId)?.createdAt || Date.now(),
        error: err.message
      });
    }
  });
}));

// GET /api/blog-pipeline/suggest/jobs/:jobId — poll for suggest job result
router.get('/suggest/jobs/:jobId', asyncHandler(async (req, res) => {
  const job = suggestJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Suggest job not found or expired' });
  return res.json(job);
}));

// GET /api/blog-pipeline/runs/:id
router.get('/runs/:id', asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findById(req.params.id).lean();
  if (!run) return res.status(404).json({ error: 'Run not found' });
  return res.json(run);
}));

// GET /api/blog-pipeline/runs/:id/logs — SSE
router.get('/runs/:id/logs', async (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
  res.flushHeaders();

  let intervalId = null;

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const poll = async () => {
    try {
      const run = await BlogPipelineRun.findById(id);
      if (!run) {
        sendEvent({ type: 'error', message: 'Run not found' });
        cleanup();
        return;
      }

      if (run.status !== 'pending' && run.status !== 'running') {
        sendEvent({ type: 'complete', status: run.status, run });
        cleanup();
      } else {
        sendEvent({ type: 'status', status: run.status });
      }
    } catch (err) {
      sendEvent({ type: 'error', message: err.message });
      cleanup();
    }
  };

  const cleanup = () => {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    res.end();
  };

  intervalId = setInterval(poll, 2000);
  req.on('close', cleanup);
  req.on('error', cleanup);

  await poll();
});

// POST /api/blog-pipeline/run — requires auth
router.post('/run', requireAuth, asyncHandler(async (req, res) => {
  const { brandId, countryCode, timeRange, searchTerms, topic } = req.body;

  const effectiveBrandId = brandId || 'marketing-agent';
  const topicTrimmed = topic && String(topic).trim() ? String(topic).trim() : null;

  // Clear stuck in-flight runs (left over from killed server or old /suggest flow)
  const cleared = await BlogPipelineRun.updateMany(
    { brandId: effectiveBrandId, status: { $in: ['running', 'pending'] } },
    { $set: { status: 'failed', error: 'Superseded by new generate request' } }
  );
  if (cleared.modifiedCount > 0) {
    console.log(`[Run] Cleared ${cleared.modifiedCount} stale in-flight run(s) for brand=${effectiveBrandId}`);
  }

  const run = await BlogPipelineRun.create({
    brandId: effectiveBrandId,
    status: 'pending',
    countryCode: countryCode || 'United States',
    timeRange: timeRange || 'this week',
    searchTerms: searchTerms || 'AI agents, MLOps, LLM applications, RAG systems, prompt engineering, AI infrastructure, vector databases',
    seoScoreThreshold: 70,
    ...(topicTrimmed ? { topic: { phrase: topicTrimmed } } : {})
  });

  console.log(
    `[Run] Created runId=${run._id} | mode=${topicTrimmed ? 'topic-override' : 'full-pipeline'}${topicTrimmed ? ` | topic="${topicTrimmed}"` : ''}`
  );

  // Run in background — import here to avoid circular
  const { runSeoBlogPipeline } = require('../../agents/marketing/application/seoBlogPipeline');

  (async () => {
    const origLog = console.log;
    const capturedLogs = [];
    console.log = (...args) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      capturedLogs.push(msg);
      origLog.apply(console, args);
    };
    try {
      run.status = 'running';
      await run.save();
      console.log(`[Run] Pipeline started for runId=${run._id}`);

      const pipelineOpts = {
        countryCode: countryCode || 'United States',
        searchTermsOverride: searchTerms || 'AI agents, MLOps, LLM applications, RAG systems, prompt engineering, AI infrastructure, vector databases',
        timeRangeOverride: timeRange
      };
      if (topicTrimmed) pipelineOpts.topicOverride = topicTrimmed;

      const result = await runSeoBlogPipeline(pipelineOpts);

      console.log = origLog;
      run.logs = capturedLogs;

      if (!result.draft) {
        run.status = 'failed';
        run.error = result.picked
          ? 'Draft generation failed'
          : 'No qualifying topic found after keyword filters';
        run.artifacts = {
          trendsPath: result.trendsPath,
          serpPath: result.serpPath || null,
          draftPath: null
        };
        await run.save();
        console.log(`[Run] Pipeline ended without draft for runId=${run._id}`);
        return;
      }

      run.status = 'completed';
      run.artifacts = {
        trendsPath: result.trendsPath,
        serpPath: result.serpPath,
        draftPath: result.draftPath
      };
      run.topic = result.picked ? {
        phrase: result.picked.phrase,
        intent: result.picked.intent,
        gapScore: result.picked.gapScore,
        sourceSeed: result.picked.source_seed
      } : null;
      run.steps = {
        trends: { status: 'done' },
        keywordFilter: { status: 'done', picked: result.picked?.phrase },
        topicScoring: { status: 'done', picked: result.picked?.phrase },
        serp: { status: result.serpPath ? 'done' : 'skipped', organic: result.serpPath ? 1 : 0 },
        draft: { status: 'done', wordEstimate: result.draft?._word_estimate },
        heroImage: { status: result.heroImage ? 'done' : 'skipped', path: result.heroImage?.relativePath },
        sectionImages: { status: 'done', count: result.draft?.section_images?.length || 0 },
        seoApproval: { status: 'pending' }
      };
      if (result.draft) {
        run.draft = {
          seoTitle: result.draft.seo_title,
          metaDescription: result.draft.meta_description,
          h1: result.draft.h1,
          authorTagline: result.draft.author_tagline,
          methodologyNote: result.draft.methodology_note,
          pullQuote: result.draft.pull_quote,
          sections: result.draft.sections,
          faq: result.draft.faq,
          sources: result.draft.sources,
          relatedReading: result.draft.related_reading,
          heroImage: result.draft.hero_image,
          sectionImages: result.draft.section_images,
          bodyMarkdown: result.draft.body_markdown
        };
      }
      await run.save();
      console.log(`[Run] Pipeline completed for runId=${run._id}`);
    } catch (err) {
      console.log = origLog;
      console.error(`[Run] Pipeline failed for runId=${run._id}:`, err.message);
      run.logs = capturedLogs;
      run.status = 'failed';
      run.error = err.message;
      await run.save();
    }
  })();

  return res.json({ runId: run._id, status: 'pending' });
}));

// POST /api/blog-pipeline/:id/cancel — cancel a stuck pending/running run
router.post('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (!['pending', 'running'].includes(run.status)) {
    return res.status(400).json({ error: `Cannot cancel run with status "${run.status}"` });
  }
  run.status = 'failed';
  run.error = 'Cancelled by user';
  await run.save();
  console.log(`[Run] Cancelled runId=${run._id}`);
  return res.json({ ok: true, run });
}));

// POST /api/blog-pipeline/:id/approve — requires auth
router.post('/:id/approve', requireAuth, asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status !== 'completed') {
    return res.status(400).json({ error: 'Only completed runs can be approved' });
  }

  run.status = 'approved';
  run.steps.seoApproval = { status: 'done', approved: true };
  await run.save();
  return res.json({ ok: true, run });
}));

// POST /api/blog-pipeline/:id/reject — requires auth
router.post('/:id/reject', requireAuth, asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  run.status = 'rejected';
  run.steps.seoApproval = { status: 'done', approved: false };
  await run.save();
  return res.json({ ok: true, run });
}));

// DELETE /api/blog-pipeline/:id — delete a run and its associated image files (requires auth)
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findByIdAndDelete(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  // Collect all image paths stored on this run and delete the files from disk
  const imagePaths = [];
  const hero = run.draft?.heroImage;
  if (hero?.relativePath) imagePaths.push(hero.relativePath);
  if (hero?.path) imagePaths.push(hero.path);
  const sections = run.draft?.sectionImages || [];
  sections.forEach(img => {
    if (img?.relativePath) imagePaths.push(img.relativePath);
    if (img?.path) imagePaths.push(img.path);
  });

  let deletedImages = 0;
  for (const rel of [...new Set(imagePaths)]) {
    try {
      const abs = path.resolve(BLOG_RUNS_DIR, path.basename(rel));
      if (fs.existsSync(abs)) { fs.unlinkSync(abs); deletedImages++; }
    } catch (_) {}
  }

  return res.json({ ok: true, deletedImages });
}));

// POST /api/blog-pipeline/:id/post — post approved blog to remote API (requires auth)
router.post('/:id/post', requireAuth, asyncHandler(async (req, res) => {
  const run = await BlogPipelineRun.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved runs can be posted' });
  }

  // Adapt flat draft to the shape post.js expects
  const adaptedBlog = {
    seo_title: run.draft?.seoTitle,
    title: run.draft?.seoTitle,
    meta_description: run.draft?.metaDescription,
    h1: run.draft?.h1,
    author_tagline: run.draft?.authorTagline || '',
    methodology_note: run.draft?.methodologyNote || '',
    pull_quote: run.draft?.pullQuote || '',
    body_markdown: run.draft?.bodyMarkdown || '',
    sections: run.draft?.sections,
    faq: run.draft?.faq,
    sources: run.draft?.sources,
    relatedReading: run.draft?.relatedReading,
    hero_image: run.draft?.heroImage,
    section_images: run.draft?.sectionImages,
    word_count: run.draft?.bodyMarkdown?.split(/\s+/).length || 0,
    target_keyword: run.topic?.phrase || ''
  };

  const adapted = adaptDraftForApproval(adaptedBlog);

  try {
    const result = await postBlog(adapted, { approved: true });
    run.status = 'published';
    await run.save();
    return res.json({ ok: true, postResult: result });
  } catch (err) {
    return res.status(500).json({ error: `Post failed: ${err.message}` });
  }
}));

module.exports = router;