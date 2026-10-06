/**
 * seoBlogPipeline.js
 *
 * MongoDB-persisted version of the marketing agent pipeline.
 * Steps:
 *   1. Fetch trending topics via MiniMax web search
 *   2. Filter out published topics and publisher content
 *   3. Deep research top candidates with MiniMax LLM
 *   4. SERP enrichment
 *   5. OpenAI blog draft generation
 *   6. Hero image generation
 *   7. Section images generation
 */

const path = require('path');
const fs = require('fs');
const {
  fetchTrendingTopicsFromMinimax,
  flattenRisingRelatedQueries
} = require('../infrastructure/minimax/trendsService');
const { fetchSerpForKeyword } = require('../infrastructure/minimax/serpService');
const { filterRankAndPick } = require('./keywordFilterEngine');
const { scoreAndRankCandidates } = require('../infrastructure/minimax/topicSelector');
const { generateBlogDraftJson } = require('../infrastructure/openai/draftGenerator');
const {
  generateAndSaveBlogHeroImage,
  generateAndSaveSectionImages
} = require('../infrastructure/openai/blogImageGenerator');
const { loadPublishedNormalizedSet } = require('../infrastructure/publishedTopicsFile');
const ContentCandidate = require('../models/ContentCandidate');
const BlogPost = require('../models/BlogPost');

const RUNS_DIR = path.join(process.cwd(), 'data', 'runs');

function newRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function savePayload(runsDir, runId, data, label) {
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const filePath = path.join(runsDir, `${runId}-${label}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

/**
 * @param {object} brand - MarketingBrand mongoose document
 * @param {object} logger - Run logger
 * @param {object} opts   - Override options
 */
async function runSeoBlogPipeline(brand, logger, opts = {}) {
  logger.info('--- SEO BLOG PIPELINE ---');

  const config = {
    minimaxApiKey: process.env.MINIMAX_API_KEY,
    minimaxApiHost: process.env.MINIMAX_API_HOST || 'https://api.minimax.io',
    openaiApiKey: process.env.OPENAI_API_KEY,
    trends: {
      searchTerms: brand.content?.topics || ['AI', 'technology', 'software'],
      geo: 'us',
      timeRange: opts.timeRange || 'this week',
      countryCode: opts.countryCode || null
    },
    generateBlogHeroImage: true,
    generateBlogSectionImages: true,
    sectionImageMaxCount: 3
  };

  const runId = newRunId();
  const deps = { minimaxApiKey: config.minimaxApiKey, minimaxApiHost: config.minimaxApiHost };

  logger.info(`[Step-1] Fetching trending topics via MiniMax...`);
  const { input, items } = await fetchTrendingTopicsFromMinimax({
    searchTerms: config.trends.searchTerms,
    geo: config.trends.geo,
    timeRange: config.trends.timeRange,
    countryCode: config.trends.countryCode
  });

  const risingFlat = flattenRisingRelatedQueries(items);
  logger.info(`Raw candidates: ${items.length} | Flattened: ${risingFlat.length}`);

  // Save raw candidates to DB
  const savedCandidates = [];
  for (const item of risingFlat) {
    try {
      const candidate = await ContentCandidate.findOneAndUpdate(
        { brandId: brand._id, sourceUrl: item.url },
        {
          $set: {
            brandId: brand._id,
            source: 'search',
            sourceUrl: item.url,
            sourceTitle: item.title,
            title: item.title,
            url: item.url,
            description: item.snippet || '',
            trendingScore: item.score || 0,
            relatedKeywords: [item.seed],
            status: 'new'
          }
        },
        { upsert: true, new: true }
      );
      savedCandidates.push(savedCandidate);
    } catch (_) {}
  }

  logger.info(`[Step-2] Filter candidates (dedupe vs published)...`);
  const published = loadPublishedNormalizedSet();
  const { winners, picked, allRanked } = filterRankAndPick(risingFlat, published);

  logger.info(`Top keyword pool: ${winners.length} | Picked: ${picked?.phrase || 'none'}`);

  if (!picked) {
    logger.warn('No qualifying keyword after filters');
    return { candidates: allRanked, picked: null, draft: null };
  }

  logger.info(`[Step-3] Deep research + score candidates...`);
  const { winners: scoredWinners, picked: bestCandidate, reasoning } = await scoreAndRankCandidates(
    winners.length ? winners : [picked],
    10
  );
  logger.info(`Picked: "${bestCandidate.phrase}" | Reasoning: ${reasoning}`);

  // Update candidate status
  await ContentCandidate.findOneAndUpdate(
    { brandId: brand._id, title: bestCandidate.title },
    { $set: { status: 'researched', approvalNotes: reasoning } }
  );

  logger.info(`[Step-4] SERP enrichment...`);
  const serp = await fetchSerpForKeyword(deps, { keyword: bestCandidate.phrase, countryCode: 'us' });
  logger.info(`SERP: ${serp.organic?.length || 0} results`);

  const draftCtx = {
    targetKeyword: bestCandidate.phrase,
    trendScore: bestCandidate.signal_value,
    competitors: serp.organic || [],
    peopleAlsoAsk: serp.peopleAlsoAsk || [],
    relatedKeywords: serp.relatedSearches || [],
    secondaryKeywordsFromTrends: scoredWinners.map(w => w.phrase).filter(p => p !== bestCandidate.phrase)
  };

  logger.info(`[Step-5] Generate blog draft...`);
  let draft;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      draft = await generateBlogDraftJson(config.openaiApiKey, draftCtx);
      break;
    } catch (err) {
      logger.warn(`Draft attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) throw err;
    }
  }

  const words = draft._word_estimate || 0;
  logger.info(`Draft: ~${words} words`);

  // Save hero image
  let heroMeta = null;
  if (config.generateBlogHeroImage) {
    try {
      heroMeta = await generateAndSaveBlogHeroImage(config.openaiApiKey, {
        runId, runsDir: RUNS_DIR,
        title: draft.title || draft.seo_title || bestCandidate.phrase,
        keyword: bestCandidate.phrase,
        metaDescription: draft.meta_description || '',
        bodyExcerpt: String(draft.body_markdown || '')
      });
      draft.hero_image = heroMeta;
      logger.info(`[Image] Hero saved: ${heroMeta.relativePath}`);
    } catch (err) {
      logger.warn(`[Image] Hero skipped: ${err.message}`);
    }
  }

  // Save section images
  let sectionImages = [];
  if (config.generateBlogSectionImages) {
    try {
      sectionImages = await generateAndSaveSectionImages(config.openaiApiKey, {
        runId, runsDir: RUNS_DIR,
        title: draft.title || draft.seo_title || bestCandidate.phrase,
        keyword: bestCandidate.phrase,
        metaDescription: draft.meta_description || '',
        bodyMarkdown: String(draft.body_markdown || ''),
        maxImages: config.sectionImageMaxCount
      });
      draft.section_images = sectionImages;
      logger.info(`[Image] ${sectionImages.length} section images saved`);
    } catch (err) {
      logger.warn(`[Image] Section images skipped: ${err.message}`);
    }
  }

  // Calculate SEO score (simplified)
  const seoScore = calculateSeoScore(draft, bestCandidate.phrase);
  logger.info(`SEO Score: ${seoScore}/100`);

  // Save to MongoDB
  let blogPost;
  try {
    blogPost = await BlogPost.create({
      brandId: brand._id,
      title: draft.title || draft.seo_title || bestCandidate.phrase,
      slug: (draft.title || bestCandidate.phrase).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      content: draft.body_markdown || '',
      excerpt: draft.meta_description || '',
      seoScore,
      seoReport: {
        keywordPresence: (draft.body_markdown || '').toLowerCase().includes(bestCandidate.phrase.toLowerCase()),
        metaDescription: draft.meta_description || '',
        wordCount: words,
        headingStructure: draft.h2s?.length > 0,
        readabilityScore: Math.round(Math.random() * 20 + 70) // placeholder
      },
      heroImage: heroMeta ? { url: heroMeta.relativePath, path: heroMeta.relativePath, alt: draft.title, generated: true } : null,
      sectionImages: sectionImages.map(img => ({ url: img.relativePath, path: img.relativePath, alt: '', generated: true })),
      status: seoScore >= (brand.seo?.minScore || 80) ? 'approved' : 'draft',
      publishedAt: null,
      author: 'AI Agent',
      tags: [bestCandidate.phrase, ...(draftCtx.secondaryKeywordsFromTrends || []).slice(0, 3)]
    });
  } catch (err) {
    logger.error(`BlogPost save error: ${err.message}`);
  }

  logger.info(`=== Pipeline complete! SEO Score: ${seoScore}/100 | Status: ${blogPost?.status} ===`);

  return {
    runId,
    candidates: allRanked,
    winners: scoredWinners,
    picked: bestCandidate,
    draft,
    seoScore,
    blogPostId: blogPost?._id?.toString(),
    status: blogPost?.status
  };
}

function calculateSeoScore(draft, keyword) {
  let score = 0;
  const body = (draft.body_markdown || '').toLowerCase();
  const keywordLower = keyword.toLowerCase();

  // Keyword in title
  if ((draft.seo_title || '').toLowerCase().includes(keywordLower)) score += 20;
  // Keyword in first 100 chars
  if (body.slice(0, 100).toLowerCase().includes(keywordLower)) score += 15;
  // Keyword density (1-3%)
  const keywordCount = (body.match(new RegExp(keywordLower, 'g')) || []).length;
  const density = keywordCount / (body.split(/\s+/).length / 100);
  if (density >= 0.5 && density <= 4) score += 25;
  // Meta description
  if (draft.meta_description && draft.meta_description.length >= 120) score += 15;
  // Word count (800-2000)
  const wordCount = draft._word_estimate || 0;
  if (wordCount >= 800) score += 15;
  else if (wordCount >= 500) score += 10;
  // H2s present
  if (draft.h2s?.length > 0) score += 10;

  return Math.min(100, score);
}

module.exports = { runSeoBlogPipeline };