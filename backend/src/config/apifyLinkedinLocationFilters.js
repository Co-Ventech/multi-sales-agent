/**
 * LinkedIn (standard + Gulf): post-filter jobs before DB storage.
 * Apify search uses location[] in input, but results often include other countries.
 */

const {
  isLinkedinGulfBrand,
  filterLinkedInJobsForGulf,
  getGulfJobAllowedLocations
} = require('./apifyLinkedinGulfFilters');

const LINKEDIN_STANDARD_SLUG = 'linkedin';

const LINKEDIN_STANDARD_LOCATIONS = [
  'United States',
  'United Kingdom',
  'UK',
  'Saudi Arabia',
  'United Arab Emirates'
];

const STANDARD_COUNTRY_CODES = new Set(['us', 'gb', 'uk', 'sa', 'ae']);

const LOCATION_ALIASES = {
  'united states': ['united states', 'usa', 'u.s.a.', 'u.s.', ' us ', 'america'],
  'united kingdom': ['united kingdom', 'great britain', ' gb ', ' uk ', 'england', 'scotland', 'wales', 'northern ireland'],
  uk: ['uk', 'u.k.', 'united kingdom', 'great britain', 'england', 'scotland', 'wales'],
  'saudi arabia': ['saudi arabia', 'saudi', 'ksa', 'kingdom of saudi arabia'],
  'united arab emirates': ['united arab emirates', 'uae', 'u.a.e.', 'emirates', 'dubai', 'abu dhabi', 'sharjah']
};

/** Parsed countries outside the standard allow-list (common actor noise). */
const KNOWN_NON_STANDARD_COUNTRIES = [
  'germany',
  'india',
  'ukraine',
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
  'ireland',
  'qatar',
  'kuwait',
  'oman',
  'bahrain'
];

function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

function isLinkedinStandardBrand(brand) {
  const slug = normalize(brand?.slug);
  if (slug === LINKEDIN_STANDARD_SLUG) return true;
  const name = normalize(brand?.name);
  return name === 'linkedin';
}

function shouldFilterLinkedinJobsByLocation(brand) {
  return isLinkedinGulfBrand(brand) || isLinkedinStandardBrand(brand);
}

function getLinkedinStandardAllowedLocations(brand) {
  const saved = brand?.apify?.linkedinJobsDefaultInput?.locations;
  const list = Array.isArray(saved) ? saved.filter(Boolean) : [];
  if (list.length > 0) {
    const merged = new Set();
    const out = [];
    for (const loc of [...list, ...LINKEDIN_STANDARD_LOCATIONS]) {
      const key = normalize(loc);
      if (!key || merged.has(key)) continue;
      merged.add(key);
      out.push(loc);
    }
    return out;
  }
  return [...LINKEDIN_STANDARD_LOCATIONS];
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

function isUkraineLocation(text) {
  return /\bukr\b/.test(text) || text === 'ukr' || text.includes('ukraine');
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

function isKnownNonStandardCountry(countryName) {
  const c = normalize(countryName);
  if (!c) return false;
  return KNOWN_NON_STANDARD_COUNTRIES.some((n) => c === n || c.includes(n));
}

function extractLinkedInJobLocationText(item) {
  const parsed = item?.location?.parsed || {};
  const parts = [
    parsed.country,
    parsed.countryFull,
    parsed.text,
    item?.location?.linkedinText,
    item?.location?.country,
    item?.location?.city && (parsed.country || item?.location?.country)
      ? `${item.location.city}, ${parsed.country || item.location.country}`
      : null
  ].filter(Boolean);
  return normalize(parts.join(' | '));
}

function parsedCountryCodeMatchesStandard(item) {
  const parsed = item?.location?.parsed || {};
  const code = normalize(parsed.countryCode || item?.location?.countryCode || '');
  return code && STANDARD_COUNTRY_CODES.has(code);
}

function jobItemMatchesLinkedinStandardLocation(item, allowedLocations) {
  const matchers = buildMatchers(allowedLocations);
  const parsed = item?.location?.parsed || {};
  const parsedCountry = normalize(parsed.country || parsed.countryFull || item?.location?.country || '');

  if (parsedCountry && isKnownNonStandardCountry(parsedCountry)) {
    if (!textMatchesAllowed(parsedCountry, matchers)) return false;
  }

  if (parsedCountryCodeMatchesStandard(item)) {
    const code = normalize(parsed.countryCode || item?.location?.countryCode || '');
    if (code === 'us' || code === 'gb' || code === 'uk' || code === 'sa' || code === 'ae') {
      return true;
    }
  }

  const locationText = extractLinkedInJobLocationText(item);
  if (locationText && textMatchesAllowed(locationText, matchers)) {
    return true;
  }

  const qLoc = normalize(item?.query?.location || '');
  if (qLoc && textMatchesAllowed(qLoc, matchers)) {
    if (parsedCountry && isKnownNonStandardCountry(parsedCountry)) return false;
    if (!parsedCountry || textMatchesAllowed(parsedCountry, matchers)) {
      return true;
    }
  }

  return false;
}

function filterLinkedInJobsForStandard(rawItems, brand) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const allowed = getLinkedinStandardAllowedLocations(brand);
  const kept = [];
  let dropped = 0;

  for (const item of items) {
    if (jobItemMatchesLinkedinStandardLocation(item, allowed)) {
      kept.push(item);
    } else {
      dropped++;
    }
  }

  return { items: kept, dropped, kept: kept.length, allowedLocations: allowed };
}

/** Route to Gulf, standard LinkedIn, or no-op filter. */
function filterLinkedInJobsForBrand(rawItems, brand) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (isLinkedinGulfBrand(brand)) {
    return filterLinkedInJobsForGulf(items, brand);
  }
  if (isLinkedinStandardBrand(brand)) {
    return filterLinkedInJobsForStandard(items, brand);
  }
  return { items, dropped: 0, kept: items.length, allowedLocations: [] };
}

module.exports = {
  LINKEDIN_STANDARD_SLUG,
  LINKEDIN_STANDARD_LOCATIONS,
  isLinkedinStandardBrand,
  shouldFilterLinkedinJobsByLocation,
  getLinkedinStandardAllowedLocations,
  getGulfJobAllowedLocations,
  jobItemMatchesLinkedinStandardLocation,
  filterLinkedInJobsForStandard,
  filterLinkedInJobsForBrand
};
