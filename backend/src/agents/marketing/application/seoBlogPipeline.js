const path = require('path');
const fs = require('fs');
const config = require('../../../config/marketing');
const { loadPublishedNormalizedSet } = require('../infrastructure/publishedTopicsFile');
const {
  fetchTrendingTopicsFromMinimax,
  flattenRisingRelatedQueries
} = require('../../../infrastructure/minimax/trendsService');
const { fetchSerpForKeyword } = require('../../../infrastructure/minimax/serpService');
const { filterRankAndPick } = require('./keywordFilterEngine');
const { scoreAndRankCandidates } = require('../../../infrastructure/minimax/topicSelector');
const { generateBlogDraftJson } = require('../../../infrastructure/openai/draftGenerator');
const {
  generateAndSaveBlogHeroImage,
  generateAndSaveSectionImages
} = require('../../../infrastructure/openai/blogImageGenerator');

const RUNS_DIR = path.join(process.cwd(), 'data', 'runs');

function requireEnv() {
  if (!config.minimaxApiKey) throw new Error('MINIMAX_API_KEY is required');
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
}

function newRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}


/**
 * Trends → filter → SERP → OpenAI draft. Artifacts under data/runs/.
 * Dedupe vs data/published_topics.txt (one normalized phrase per line), optional.
 * If topicOverride is set, steps 2-3 are skipped and that topic is used directly.
 */
async function runSeoBlogPipeline({ countryCode = 'us', searchTermsOverride, timeRangeOverride, topicOverride } = {}) {
  requireEnv();

  const runId = newRunId();
  const deps = {
    minimaxApiKey: config.minimaxApiKey,
    minimaxApiHost: config.minimaxApiHost
  };

  // Allow runtime overrides (from API request body)
  const parseSearchTerms = (raw) => {
    if (Array.isArray(raw)) return raw.map(s => s.trim()).filter(Boolean);
    if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
    return config.trends.searchTerms;
  };
  const effectiveSearchTerms = searchTermsOverride ? parseSearchTerms(searchTermsOverride) : config.trends.searchTerms;
  const effectiveTimeRange = timeRangeOverride || config.trends.timeRange;

  console.log('\n[Step-1] Collect trending topics via MiniMax');
  console.log(`[Config] searchTerms=${JSON.stringify(effectiveSearchTerms)} | geo=${config.trends.geo} | countryCode="${countryCode}" | timeRange="${effectiveTimeRange}"`);
  console.log('[Trends] Fetching trending topics via MiniMax web_search...');

  const { input, items } = await fetchTrendingTopicsFromMinimax({
    searchTerms: effectiveSearchTerms,
    geo: config.trends.geo,
    timeRange: effectiveTimeRange,
    countryCode
  });

  const risingFlat = flattenRisingRelatedQueries(items);
  console.log(`[Trends] Total raw candidates: ${items.length}`);
  console.log(`[Trends] After flatten: ${risingFlat.length} candidates`);

  const published = loadPublishedNormalizedSet();

  let bestCandidate;
  let scoredWinners = [];
  let reasoning = '';
  let allRanked = [];

  if (topicOverride) {
    console.log(`[Pipeline] topicOverride set — skipping steps 2-3, using: "${topicOverride}"`);
    bestCandidate = {
      phrase: topicOverride,
      intent: 'INFORMATIONAL',
      gapScore: 6,
      source_seed: 'manual',
      signal_value: 50
    };
  } else {
    console.log('\n[Step-2] Filter and rank keyword candidates');
    console.log(`[Keywords] Loading published topics for dedupe: ${published.size} already published`);
    const { winners, picked, allRanked: ranked } = filterRankAndPick(risingFlat, published);
    allRanked = ranked;

    console.log(`[Keywords] Candidates after filtering: ${allRanked.length} total | Top pool: ${winners.length}`);
    console.log('[Keywords] Top candidates:');
    winners.forEach((w, i) => {
      console.log(`  ${i + 1}. "${w.phrase}" (seed="${w.source_seed}")`);
    });

    if (!picked) {
      console.warn('[Keywords] No qualifying keyword after filters.');
      return { runId, winners: [], picked: null, draft: null };
    }
    console.log(`[Keywords] Picked topic: "${picked.phrase}"`);

    const candidates = winners.length ? winners : [picked];

    console.log('\n[Step-3] Deep research + score candidates via MiniMax LLM');
    console.log(`[TopicScore] Deep-researching ${candidates.length} candidates with 6 search angles each...`);
    try {
      const scored = await scoreAndRankCandidates(candidates, 10);
      scoredWinners = scored.winners;
      bestCandidate = scored.picked;
      reasoning = scored.reasoning;
    } catch (err) {
      console.error(`[TopicScore] Scoring failed: ${err.message}`);
      throw err;
    }
    console.log(`[TopicScore] MiniMax picked: "${bestCandidate.phrase}"`);
    if (reasoning) console.log(`[TopicScore] Reasoning: ${reasoning}`);

    console.log('[TopicScore] All scored candidates:');
    scoredWinners.forEach((s, i) => {
      console.log(`  ${i + 1}. "${s.phrase}" (intent=${s.intent}, gapScore=${s.gapScore}/12, recentNews=${s.recentOrganicCount}, related=${s.relatedRichness})`);
    });
  }

  console.log('\n[Step-4] SERP enrichment for best topic via MiniMax');
  serp = await fetchSerpForKeyword({}, { keyword: bestCandidate.phrase, countryCode });
  console.log(`[SERP] organic=${serp.organic.length} results | related=${serp.relatedSearches.length} queries | paa=0 (not available)`);

  draftCtx = {
    targetKeyword: bestCandidate.phrase,
    trendScore: bestCandidate.signal_value,
    competitors: serp.organic,
    peopleAlsoAsk: serp.peopleAlsoAsk,
    relatedKeywords: serp.relatedSearches,
    secondaryKeywordsFromTrends: scoredWinners.map((w) => w.phrase).filter((p) => p !== bestCandidate.phrase)
  };

  console.log(
    `\n[Step-5] Generate blog draft for "${bestCandidate.phrase}" (model=${process.env.OPENAI_DRAFT_MODEL || 'gpt-4.1'})`
  );
  console.log(`[Draft] competitors=${serp.organic.length} | relatedKeywords=${serp.relatedSearches.length} | secondaryTopics=${scoredWinners.length - 1}`);
  let draft;
  let lastDraftErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      draft = await generateBlogDraftJson(config.openaiApiKey, draftCtx);
      console.log(`[Draft] Draft generated (~${draft._word_estimate || 0} words).`);
      break;
    } catch (err) {
      lastDraftErr = err;
      console.warn(`[Draft] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) {
        console.log('[Draft] Retrying...');
      }
    }
  }

  if (!draft) {
    throw new Error(`Draft generation failed after 3 attempts.${lastDraftErr ? ` Last: ${lastDraftErr.message}` : ''}`);
  }


  const words = draft._word_estimate || 0;

  console.log('\n[Step-6] Generate hero image');
  console.log('[Image] Generating hero image (OpenAI Images API)...');
  if (config.generateBlogHeroImage) {
    try {
      const heroMeta = await generateAndSaveBlogHeroImage(config.openaiApiKey, {
        runId,
        runsDir: RUNS_DIR,
        title: draft.title || draft.seo_title || draft.h1 || bestCandidate.phrase,
        keyword: bestCandidate.phrase,
        metaDescription: draft.meta_description || '',
        bodyExcerpt: String(draft.body_markdown || '')
      });
      draft.hero_image = heroMeta;
      console.log(`[Image] Hero saved: ${heroMeta.relativePath}`);
    } catch (err) {
      console.warn(`[Image] Skipped: ${err.message}`);
    }
  } else {
    console.log('[Image] Skipped (disabled in config)');
  }

  console.log('\n[Step-7] Generate section images');
  console.log('[Image] Generating section images (OpenAI Images API)...');
  if (config.generateBlogSectionImages) {
    try {
      const sectionImages = await generateAndSaveSectionImages(config.openaiApiKey, {
        runId,
        runsDir: RUNS_DIR,
        title: draft.title || draft.seo_title || draft.h1 || bestCandidate.phrase,
        keyword: bestCandidate.phrase,
        metaDescription: draft.meta_description || '',
        bodyMarkdown: String(draft.body_markdown || ''),
        maxImages: config.sectionImageMaxCount
      });
      if (sectionImages.length) {
        draft.section_images = sectionImages;
        console.log(`[Image] Section images saved: ${sectionImages.map((x) => x.relativePath).join(', ')}`);
      } else {
        console.log('[Image] Section images skipped (no eligible sections found).');
      }
    } catch (err) {
      console.warn(`[Image] Section images skipped: ${err.message}`);
    }
  } else {
    console.log('[Image] Skipped (disabled in config)');
  }

  console.log('\n========================================');
  console.log('[Pipeline] Complete');
  console.log(`  Topic:      ${bestCandidate.phrase}`);
  console.log(`  Words:      ~${words}`);
  console.log(`  SEO title:  ${draft.seo_title || draft.title || ''}`);
  console.log('========================================');

  return {
    runId,
    draftCtx,
    heroImage: draft.hero_image || null,
    winners: scoredWinners,
    picked: bestCandidate,
    draft,
    allRankedCount: allRanked.length
  };
}

/**
 * Steps 1-3 only: Trends → Filter → Score.
 * Returns scored candidates without running SERP or draft generation.
 */
async function suggestTopics({ countryCode = 'us', searchTermsOverride, timeRangeOverride } = {}) {
  requireEnv();

  const parseSearchTerms = (raw) => {
    if (Array.isArray(raw)) return raw.map(s => s.trim()).filter(Boolean);
    if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
    return config.trends.searchTerms;
  };
  const effectiveSearchTerms = searchTermsOverride ? parseSearchTerms(searchTermsOverride) : config.trends.searchTerms;
  const effectiveTimeRange = timeRangeOverride || config.trends.timeRange;

  console.log('\n[Suggest] Step-1 Collect trending topics via MiniMax');
  console.log(`[Config] searchTerms=${JSON.stringify(effectiveSearchTerms)} | geo=${config.trends.geo} | countryCode="${countryCode}" | timeRange="${effectiveTimeRange}"`);

  const { input, items } = await fetchTrendingTopicsFromMinimax({
    searchTerms: effectiveSearchTerms,
    geo: config.trends.geo,
    timeRange: effectiveTimeRange,
    countryCode
  });

  const risingFlat = flattenRisingRelatedQueries(items);
  console.log(`[Suggest] Total raw: ${items.length} | After flatten: ${risingFlat.length}`);

  const published = loadPublishedNormalizedSet();
  console.log('\n[Suggest] Step-2 Filter and rank keyword candidates');
  const { winners, picked, allRanked } = filterRankAndPick(risingFlat, published);
  console.log(`[Keywords] Filtered: ${allRanked.length} total | Pool: ${winners.length}`);
  winners.forEach((w, i) => console.log(`  ${i + 1}. "${w.phrase}" (seed="${w.source_seed}")`));

  if (!picked) {
    return { winners: [], picked: null, allRankedCount: allRanked.length };
  }

  const candidates = winners.length ? winners : [picked];
  console.log('\n[Suggest] Step-3 Deep research + score via MiniMax LLM');
  let scoredWinners, bestCandidate, reasoning;
  try {
    const scored = await scoreAndRankCandidates(candidates, 10);
    scoredWinners = scored.winners;
    bestCandidate = scored.picked;
    reasoning = scored.reasoning;
  } catch (err) {
    console.error(`[Suggest] Scoring failed: ${err.message}`);
    throw err;
  }

  console.log(`[Suggest] Picked: "${bestCandidate.phrase}" (intent=${bestCandidate.intent}, gapScore=${bestCandidate.gapScore}/12)`);
  scoredWinners.forEach((s, i) => {
    console.log(`  ${i + 1}. "${s.phrase}" gap=${s.gapScore}/12 recent=${s.recentOrganicCount} intent=${s.intent}`);
  });

  return {
    winners: scoredWinners,
    picked: bestCandidate,
    reasoning,
    allRankedCount: allRanked.length
  };
}

module.exports = { runSeoBlogPipeline, suggestTopics, RUNS_DIR };
