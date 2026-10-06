try {
  require('dotenv').config();
} catch (_) {}

function bool(v, defaultVal = false) {
  if (v === undefined || v === null || v === '') return defaultVal;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

function parseSearchTerms() {
  // AI-focused industry coverage. Used when no TRENDS_SEARCH_TERMS env var
  // is set and no override is passed by the caller. Mirrors the default in
  // src/api/routes/blogPipeline.js so the cron pipeline and the UI path
  // surface the same industry-relevant topics.
  const raw = process.env.TRENDS_SEARCH_TERMS || 'AI agents, MLOps, LLM applications, RAG systems, prompt engineering, AI infrastructure, vector databases';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Map time range values to natural-language qualifiers that MiniMax web_search
 * understands as time filters. Maps legacy Google Trends/Apify format
 * (e.g. "now 1-d", "now 7-d") to natural language ("today", "this week", etc.)
 * and accepts either form on input. Pass-through for unknown values.
 */
const TIME_RANGE_MAP = {
  'now 1-d': 'today',
  'now 1d': 'today',
  'today': 'today',
  'past 1 day': 'today',
  'last 24 hours': 'today',
  'last 24h': 'today',
  'now 3-d': 'past 3 days',
  'now 3d': 'past 3 days',
  'past 3 days': 'past 3 days',
  'last 3 days': 'past 3 days',
  'now 7-d': 'this week',
  'now 7d': 'this week',
  'this week': 'this week',
  'past 7 days': 'this week',
  'last 7 days': 'this week',
  'now 30-d': 'this month',
  'now 30d': 'this month',
  'this month': 'this month',
  'past 30 days': 'this month',
  'last 30 days': 'this month'
};

function normalizeTimeRange(raw) {
  const t = String(raw || 'this week').trim().toLowerCase().replace(/\s+/g, ' ');
  if (TIME_RANGE_MAP[t]) return TIME_RANGE_MAP[t];
  // Pass through unknown values — they'll be appended to the search query
  return String(raw || 'this week').trim() || 'this week';
}

module.exports = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  minimaxApiKey: process.env.MINIMAX_API_KEY || '',
  minimaxApiHost: process.env.MINIMAX_API_HOST || 'https://api.minimax.io',
  apifyToken: process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN || '',
  trends: {
    searchTerms: parseSearchTerms(),
    geo: process.env.TRENDS_GEO || 'US',
    timeRange: normalizeTimeRange(
      process.env.TRENDS_TIME_RANGE !== undefined && process.env.TRENDS_TIME_RANGE !== ''
        ? process.env.TRENDS_TIME_RANGE
        : 'this week'
    ),
    useProxy: bool(process.env.GOOGLE_TRENDS_USE_PROXY, true)
  },
  actors: {
    googleTrends: 'apify~google-trends-scraper',
    googleSearch: 'apify~google-search-scraper'
  },
  apifyBase: 'https://api.apify.com/v2',
  pipelineCron: process.env.PIPELINE_CRON || '0 6 * * *',
  approveAndPost: bool(process.env.PIPELINE_APPROVE_AND_POST, false),
  /** Approve + post: max OpenAI draft attempts (initial + revisions after failed SEO audit). */
  approveMaxAttempts: Math.max(1, Number(process.env.PIPELINE_APPROVE_MAX_ATTEMPTS) || 3),
  apifyTimeoutMs: Number(process.env.APIFY_TIMEOUT_MS) || 240000,
  /** After text draft: OpenAI Images (DALL·E) hero PNG in data/runs/ */
  generateBlogHeroImage: bool(process.env.OPENAI_GENERATE_BLOG_IMAGE, true),
  generateBlogSectionImages: bool(process.env.OPENAI_GENERATE_SECTION_IMAGES, true),
  sectionImageMaxCount: Math.max(1, Number(process.env.OPENAI_SECTION_IMAGE_MAX_COUNT) || 2),
  normalizeTimeRange
};
