/**
 * Post-filter Upwork Jobs actor results by client location.
 * Apify search uses location[] in input, but results often include other countries.
 */

const UPWORK_STANDARD_SLUG = 'upwork';
const UPWORK_GULF_SLUG = 'upwork-gulf';

const UPWORK_STANDARD_LOCATIONS = [
  'United States',
  'United Kingdom',
  'UK',
  'Saudi Arabia',
  'United Arab Emirates'
];

const UPWORK_GULF_LOCATIONS = [
  'Saudi Arabia',
  'Qatar',
  'United Arab Emirates',
  'Kuwait',
  'Oman',
  'Bahrain'
];

const LOCATION_ALIASES = {
  'united states': ['united states', 'usa', 'u.s.a.', 'u.s.', ' us ', 'america'],
  'united kingdom': ['united kingdom', 'great britain', ' gb ', ' uk ', 'england', 'scotland', 'wales', 'northern ireland'],
  uk: ['uk', 'u.k.', 'united kingdom', 'great britain', 'england', 'scotland', 'wales'],
  'saudi arabia': ['saudi arabia', 'saudi', 'ksa', 'kingdom of saudi arabia'],
  'united arab emirates': ['united arab emirates', 'uae', 'u.a.e.', 'emirates', 'dubai', 'abu dhabi', 'sharjah'],
  qatar: ['qatar', 'doha'],
  kuwait: ['kuwait'],
  oman: ['oman', 'muscat'],
  bahrain: ['bahrain', 'manama']
};

/** Client locations that must never be stored (common actor noise). */
const KNOWN_NON_ALLOWED_SNIPPETS = [
  'germany',
  'india',
  'ukraine',
  'ukr',
  'pakistan',
  'bangladesh',
  'philippines',
  'canada',
  'australia',
  'france',
  'netherlands',
  'poland',
  'brazil',
  'mexico',
  'nigeria',
  'egypt',
  'turkey',
  'israel',
  'italy',
  'spain',
  'ukraine'
];

function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

function isUpworkGulfBrand(brand) {
  const slug = normalize(brand?.slug);
  if (slug === UPWORK_GULF_SLUG) return true;
  const name = normalize(brand?.name);
  return name === 'upwork-gulf' || name === 'upwork gulf';
}

function isUpworkStandardBrand(brand) {
  const slug = normalize(brand?.slug);
  if (slug === UPWORK_STANDARD_SLUG) return true;
  const name = normalize(brand?.name);
  return name === 'upwork';
}

function shouldFilterUpworkByLocation(brand) {
  return isUpworkGulfBrand(brand) || isUpworkStandardBrand(brand);
}

function mergeLocationLists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const loc of list || []) {
      const key = normalize(loc);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(loc);
    }
  }
  return out;
}

function getUpworkAllowedLocations(brand) {
  const saved = brand?.apify?.defaultInput?.location;
  const list = Array.isArray(saved) ? saved.filter(Boolean) : [];

  if (isUpworkGulfBrand(brand)) {
    return mergeLocationLists(list, UPWORK_GULF_LOCATIONS);
  }
  if (isUpworkStandardBrand(brand)) {
    // Always keep US, UK, Saudi Arabia, UAE even if brand preset omits UK
    return mergeLocationLists(list, UPWORK_STANDARD_LOCATIONS);
  }
  return list;
}

function buildMatchers(allowedLocations) {
  const matchers = new Set();
  for (const loc of allowedLocations) {
    const key = normalize(loc);
    if (!key) continue;
    matchers.add(key);
    for (const alias of LOCATION_ALIASES[key] || []) {
      matchers.add(alias.trim());
    }
    if (key === 'uae' || key === 'united arab emirates') {
      for (const a of LOCATION_ALIASES['united arab emirates']) matchers.add(a);
      matchers.add('united arab emirates');
    }
    if (key === 'ksa' || key === 'saudi' || key === 'saudi arabia') {
      for (const a of LOCATION_ALIASES['saudi arabia']) matchers.add(a);
      matchers.add('saudi arabia');
    }
    if (key === 'uk' || key === 'united kingdom') {
      for (const a of LOCATION_ALIASES['united kingdom']) matchers.add(a);
      matchers.add('united kingdom');
    }
    if (key === 'usa' || key === 'us' || key === 'united states') {
      for (const a of LOCATION_ALIASES['united states']) matchers.add(a);
      matchers.add('united states');
    }
  }
  return [...matchers].sort((a, b) => b.length - a.length);
}

function extractJobLocationText(item) {
  const parts = [
    item?.clientLocation,
    item?.country,
    typeof item?.location === 'string' ? item.location : null,
    item?.location?.country,
    item?.location?.name,
    item?.city && item?.country ? `${item.city}, ${item.country}` : null
  ].filter(Boolean);
  return normalize(parts.join(' | '));
}

function containsNonAllowedLocation(text) {
  if (!text) return false;
  if (/\bukr\b/.test(text) || text.includes('ukraine')) return true;
  return KNOWN_NON_ALLOWED_SNIPPETS.some((snippet) => {
    if (snippet === 'ukr' && /\buk\b/.test(text) && !text.includes('ukr')) return false;
    return text.includes(snippet);
  });
}

function isUkraineLocation(text) {
  return /\bukr\b/.test(text) || text === 'ukr' || text.includes('ukraine');
}

function isUnitedKingdomLocation(text) {
  if (!text || isUkraineLocation(text)) return false;
  if (text === 'uk' || text === 'gb' || text === 'u.k.') return true;
  const ukMatchers = buildMatchers(['United Kingdom', 'UK']);
  return textMatchesAllowedTokens(text, ukMatchers);
}

function textMatchesAllowedTokens(text, matchers) {
  const padded = ` ${text} `;
  for (const m of matchers) {
    const token = m.trim();
    if (token.length < 2) continue;
    if (token === 'uk' && isUkraineLocation(text)) continue;
    if (padded.includes(` ${token} `) || text === token) return true;
    if (token.length >= 4 && text.includes(token)) return true;
  }
  return false;
}

function textMatchesAllowed(text, matchers) {
  if (!text) return false;
  if (isUkraineLocation(text)) return false;
  return textMatchesAllowedTokens(text, matchers);
}

function jobItemMatchesUpworkLocation(item, allowedLocations) {
  const text = extractJobLocationText(item);
  if (!text) return false;

  const matchers = buildMatchers(allowedLocations);
  if (!textMatchesAllowed(text, matchers)) return false;
  if (containsNonAllowedLocation(text)) {
    return textMatchesAllowed(text, matchers);
  }
  return true;
}

function storedUpworkJobMatchesLocation(job, allowedLocations) {
  return jobItemMatchesUpworkLocation(
    {
      clientLocation: job?.clientLocation,
      country: job?.country
    },
    allowedLocations
  );
}

function filterUpworkJobsForBrand(rawItems, brand) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!shouldFilterUpworkByLocation(brand)) {
    return { items, dropped: 0, kept: items.length, allowedLocations: [] };
  }

  const allowed = getUpworkAllowedLocations(brand);
  const kept = [];
  let dropped = 0;

  for (const item of items) {
    if (jobItemMatchesUpworkLocation(item, allowed)) {
      kept.push(item);
    } else {
      dropped++;
    }
  }

  return { items: kept, dropped, kept: kept.length, allowedLocations: allowed };
}

function buildClientLocationMongoOr(allowedLocations) {
  const matchers = buildMatchers(allowedLocations);
  const or = [];
  for (const m of matchers) {
    const token = m.trim();
    if (token.length < 2) continue;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) continue;
    const pattern = token.length <= 3 ? `\\b${escaped}\\b` : escaped;
    or.push({ clientLocation: { $regex: pattern, $options: 'i' } });
  }
  return or;
}

module.exports = {
  UPWORK_STANDARD_LOCATIONS,
  UPWORK_GULF_LOCATIONS,
  isUpworkGulfBrand,
  isUpworkStandardBrand,
  shouldFilterUpworkByLocation,
  getUpworkAllowedLocations,
  jobItemMatchesUpworkLocation,
  storedUpworkJobMatchesLocation,
  filterUpworkJobsForBrand,
  buildClientLocationMongoOr
};
