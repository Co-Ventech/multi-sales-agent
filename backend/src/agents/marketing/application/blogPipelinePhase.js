const { runSeoBlogPipeline } = require('./seoBlogPipeline');
const BlogPipelineRun = require('../../../models/BlogPipelineRun');

/**
 * Capture all console.log output during pipeline execution
 */
function captureLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logs.push(msg);
    originalLog.apply(console, args);
  };
  return fn().finally(() => {
    console.log = originalLog;
  }).then(result => ({ result, logs })).catch(err => ({ error: err, logs }));
}

/**
 * Wrap marketing-agent's runSeoBlogPipeline as a backend pipeline phase.
 * Stores results in BlogPipelineRun and returns structured output.
 */
async function blogPipelinePhase(brand, logger, opts = {}) {
  logger.info('--- BLOG-PIPELINE PHASE ---');

  const { countryCode = 'US', timeRange, searchTermsOverride } = opts;

  let runDoc;
  try {
    runDoc = await BlogPipelineRun.create({
      brandId: brand._id?.toString() || brand,
      status: 'running',
      countryCode,
      seoScoreThreshold: brand.apify?.seoScoreThreshold || 70,
      logs: []
    });
  } catch (err) {
    logger.error(`Failed to create BlogPipelineRun: ${err.message}`);
    return { runId: null, status: 'failed', error: err.message };
  }

  const runId = runDoc._id.toString();

  try {
    logger.info(`[BlogPipeline] Starting pipeline for country=${countryCode}`);

    const { result, logs: capturedLogs } = await captureLogs(() =>
      runSeoBlogPipeline({ countryCode, searchTermsOverride, timeRangeOverride: timeRange })
    );

    runDoc.logs = capturedLogs;

    runDoc.status = 'completed';
    runDoc.artifacts = {
      trendsPath: result.trendsPath,
      serpPath: result.serpPath,
      draftPath: result.draftPath
    };
    runDoc.topic = result.picked ? {
      phrase: result.picked.phrase,
      intent: result.picked.intent,
      gapScore: result.picked.gapScore,
      sourceSeed: result.picked.source_seed
    } : null;
    runDoc.steps = {
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
      runDoc.draft = {
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

    await runDoc.save();

    logger.info(`[BlogPipeline] Pipeline complete. RunId=${runId} | Topic="${result.picked?.phrase}"`);

    return {
      runId,
      status: 'completed',
      topic: result.picked?.phrase,
      draft: result.draft,
      steps: runDoc.steps,
      winners: result.winners,
      logs: capturedLogs
    };

  } catch (err) {
    logger.error(`[BlogPipeline] Pipeline failed: ${err.message}`);

    runDoc.status = 'failed';
    runDoc.error = err.message;
    await runDoc.save();

    return { runId, status: 'failed', error: err.message };
  }
}

module.exports = blogPipelinePhase;