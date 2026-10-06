const fs = require('fs');
const path = require('path');
const { runActor } = require('./apifyClient');

async function fetchSerpForKeyword(deps, { keyword, countryCode = 'us' }) {
  const input = {
    queries: keyword,
    countryCode: String(countryCode).toLowerCase(),
    languageCode: 'en',
    maxPagesPerQuery: 1,
    mobileResults: false,
    saveHtml: false,
    saveHtmlToKeyValueStore: false,
    includeUnfilteredResults: false
  };

  const items = await runActor({
    base: deps.apifyBase,
    token: deps.apifyToken,
    actorId: deps.actorId,
    input,
    timeoutMs: deps.timeoutMs
  });

  return parseSerpItems(items, keyword);
}

function parseSerpItems(items, keyword) {
  const first = items[0] || {};
  let organic = [];
  let peopleAlsoAsk = [];
  let relatedSearches = [];

  const organicArray =
    first.organicResults || first.organic || [];
  const paaArray = first.peopleAlsoAsk || first.peopleAlsoAsks || first.paa || [];
  const relatedArray =
    first.relatedQueries || first.relatedSearches || first.related || [];

  if (organicArray.length || paaArray.length || relatedArray.length) {
    organic = organicArray
      .map((r) => ({
        position: r.position || 0,
        title: r.title || '',
        url: r.url || '',
        description: r.description || r.snippet || ''
      }))
      .filter((r) => r.title)
      .slice(0, 10);

    peopleAlsoAsk = paaArray
      .map((r) => r.question || r.title || r.text)
      .filter(Boolean)
      .slice(0, 12);

    relatedSearches = relatedArray
      .map((r) => r.title || r.query || r.text)
      .filter(Boolean)
      .slice(0, 12);
  } else {
    organic = items
      .filter((r) => ['organic', 'ORGANIC'].includes(r.type || r.resultType))
      .map((r) => ({
        position: r.position || 0,
        title: r.title || '',
        url: r.url || '',
        description: r.description || r.snippet || ''
      }))
      .filter((r) => r.title)
      .slice(0, 10);

    peopleAlsoAsk = items
      .filter((r) =>
        ['peopleAlsoAsk', 'PEOPLE_ALSO_ASK', 'people_also_ask'].includes(
          r.type || r.resultType
        )
      )
      .map((r) => r.question || r.title)
      .filter(Boolean)
      .slice(0, 12);

    relatedSearches = items
      .filter((r) =>
        ['relatedSearches', 'relatedSearch', 'RELATED_SEARCHES'].includes(
          r.type || r.resultType
        )
      )
      .map((r) => r.title || r.query)
      .filter(Boolean)
      .slice(0, 12);
  }

  return {
    keyword,
    organic,
    peopleAlsoAsk,
    relatedSearches,
    rawCount: items.length
  };
}

function saveSerpPayload(runsDir, runId, payload) {
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const filePath = path.join(runsDir, `${runId}-serp.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

module.exports = { fetchSerpForKeyword, saveSerpPayload, parseSerpItems };
