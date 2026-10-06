/**
 * scrapeCandidatesPhase.js
 *
 * Step 1 of marketing pipeline:
 *   - Searches for content candidates based on brand topics
 *   - Filters out publisher-heavy results (LinkedIn, Microsoft Reactor, etc.)
 *   - Returns top candidates sorted by trending score
 */

const ContentCandidate = require('../models/ContentCandidate');
const { webSearch } = require('../services/webSearchService');

const PUBLISHER_BLOCKLIST = [
  'linkedin.com', 'microsoft.com/reactor', 'github.com',
  'medium.com', 'dev.to', 'stackoverflow.com', 'reddit.com',
  'twitter.com', 'x.com', 'facebook.com', 'youtube.com'
];

async function scrapeCandidatesPhase(brand, logger, opts = {}) {
  logger.info('--- SCRAPE-CANDIDATES PHASE ---');

  const topics = brand.content?.topics || [];
  if (topics.length === 0) {
    logger.warn('No topics configured for this brand');
    return { rawCandidates: 0, filteredCandidates: 0, candidates: [] };
  }

  const allCandidates = [];
  const maxPerTopic = opts.maxPerTopic || 20;

  for (const topic of topics) {
    try {
      logger.info(`Searching for: ${topic}`);
      const results = await webSearch(topic, { numResults: maxPerTopic });

      for (const item of results) {
        const url = item.link || item.url || '';
        const isBlocked = PUBLISHER_BLOCKLIST.some(p => url.includes(p));
        const hasAuthor = item.author || item.publisher;

        allCandidates.push({
          brandId: brand._id,
          source: 'search',
          sourceUrl: url,
          sourceTitle: item.title,
          title: item.title,
          url,
          description: item.snippet || item.description || '',
          author: item.author || null,
          publishedAt: item.date ? new Date(item.date) : null,
          trendingScore: item.score || 0,
          relatedKeywords: [topic],
          status: (isBlocked || hasAuthor) ? 'rejected' : 'new',
          rejectionReason: isBlocked ? 'publisher domain blocked'
            : hasAuthor ? 'has author (publisher content)'
            : null
        });
      }
    } catch (err) {
      logger.error(`Search failed for topic "${topic}": ${err.message}`);
    }
  }

  // Deduplicate by URL
  const seen = new Map();
  for (const c of allCandidates) {
    if (!c.url) continue;
    if (!seen.has(c.url)) seen.set(c.url, c);
  }

  // Save candidates (skip blocked/rejected ones)
  let saved = 0;
  for (const c of seen.values()) {
    if (c.status === 'rejected') continue;
    try {
      await ContentCandidate.findOneAndUpdate(
        { brandId: brand._id, url: c.url },
        { $set: c },
        { upsert: true, new: true }
      );
      saved++;
    } catch (err) {
      // duplicate key — skip
    }
  }

  // Pick top N by trending score
  const topCandidates = [...seen.values()]
    .filter(c => c.status !== 'rejected')
    .sort((a, b) => b.trendingScore - a.trendingScore)
    .slice(0, opts.topN || 10);

  logger.info(`Raw: ${allCandidates.length} | Saved: ${saved} | Top: ${topCandidates.length}`);

  return {
    rawCandidates: allCandidates.length,
    filteredCandidates: saved,
    candidates: topCandidates.map(c => ({ title: c.title, url: c.url, score: c.trendingScore }))
  };
}

module.exports = scrapeCandidatesPhase;