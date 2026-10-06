/**
 * webSearchService.js
 *
 * Wrapper around MiniMax web search MCP tool.
 * Used for finding content candidates in the marketing pipeline.
 */

const { web_search } = require('mini-max-agent').mcp;

/**
 * Search the web for a query.
 * @param {string} query - Search query
 * @param {object} opts - Options: numResults (default 10)
 * @returns {Array} Array of search results with title, url, snippet, date
 */
async function webSearch(query, opts = {}) {
  const numResults = opts.numResults || 10;

  try {
    const result = await web_search({ query, numResults });

    if (!result || !result.organic) {
      return [];
    }

    return result.organic.map(item => ({
      title: item.title || '',
      url: item.url || item.link || '',
      snippet: item.snippet || '',
      date: item.date || null,
      score: item.score || 0,
      author: item.author || null,
      publisher: item.publisher || null
    }));
  } catch (err) {
    console.error('[WebSearch] Error:', err.message);
    return [];
  }
}

/**
 * Deep research: gather detailed info about a topic.
 * @param {string} query
 * @returns {object} Research data
 */
async function deepResearch(query) {
  const results = await webSearch(query, { numResults: 15 });

  return {
    query,
    results,
    timestamp: new Date()
  };
}

module.exports = { webSearch, deepResearch };