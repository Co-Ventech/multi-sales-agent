const fs = require('fs');
const path = require('path');
const { callWebSearch } = require('./minimaxClient');

/**
 * Fetch SERP data (organic results + related searches) for a keyword via MiniMax web_search.
 *
 * @param {object} deps
 * @param {string} deps.apifyBase — (unused, kept for signature compatibility)
 * @param {string} deps.apifyToken — (unused)
 * @param {string} deps.actorId — (unused)
 * @param {number} deps.timeoutMs — (unused)
 * @param {object} opts
 * @param {string} opts.keyword
 * @param {string} opts.countryCode — (unused for now; MiniMax web_search is global)
 * @returns {Promise<{keyword:string, organic: Array, peopleAlsoAsk: string[], relatedSearches: string[], rawCount: number}>}
 */
async function fetchSerpForKeyword(deps, { keyword, countryCode }) {
  let data;
  try {
    data = await callWebSearch(keyword);
  } catch (err) {
    console.warn(`  [Minimax SERP] web_search failed for "${keyword}": ${err.message}`);
    // Return empty structure so pipeline can fall back gracefully
    return {
      keyword,
      organic: [],
      peopleAlsoAsk: [],   // no PAA tool in MiniMax MCP
      relatedSearches: [],
      rawCount: 0
    };
  }

  const organic = Array.isArray(data.organic) ? data.organic : [];
  const relatedRaw = Array.isArray(data.related_searches) ? data.related_searches : [];

  // Map MiniMax shape to the same shape as the old Apify serpService output
  const mappedOrganic = organic.map((item, idx) => ({
    position: idx,
    title: item.title || '',
    url: item.link || '',
    description: item.snippet || ''
  })).filter((r) => r.title);

  const relatedSearches = relatedRaw
    .map((r) => r.query || r.title || '')
    .filter(Boolean);

  return {
    keyword,
    organic: mappedOrganic,
    peopleAlsoAsk: [],   // no PAA tool in MiniMax MCP
    relatedSearches,
    rawCount: organic.length
  };
}

function saveSerpPayload(runsDir, runId, payload) {
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const filePath = path.join(runsDir, `${runId}-serp.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

module.exports = { fetchSerpForKeyword, saveSerpPayload };