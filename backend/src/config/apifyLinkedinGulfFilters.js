/**
 * LinkedIn-Gulf: post-filter jobs from the LinkedIn Jobs actor.
 *
 * Apify searches with Gulf countries in `locations`, but many results are
 * global companies (EMEA / US / EU HQ) reposting broad remote roles. We only keep
 * jobs whose work location is in a GCC country (parsed fields), not jobs that
 * merely appeared because the search query targeted a Gulf market.
 */

const LINKEDIN_GULF_SLUG = 'linkedin-gulf';

const GULF_JOB_COUNTRIES = [
  'Saudi Arabia',
  'Qatar',
  'United Arab Emirates',
  'Kuwait',
  'Oman',
  'Bahrain'
];

/** ISO 3166-1 alpha-2 codes for GCC countries. */
const GULF_COUNTRY_CODES = new Set(['sa', 'ae', 'qa', 'kw', 'om', 'bh']);

/** Broad region labels — not acceptable as the job location on their own. */
const NON_COUNTRY_REGION_LABELS = new Set([
  'mena',
  'emea',
  'apac',
  'latam',
  'europe',
  'eastern region',
  'western region',
  'northern region',
  'southern region'
]);

/** Parsed countries that are never Gulf (common actor mis-tags). */
const KNOWN_NON_GULF_COUNTRIES = [
  'united states',
  'united states of america',
  'united kingdom',
  'uk',
  'ethiopia',
  'iceland',
  'belgium',
  'finland',
  'poland',
  'germany',
  'france',
  'india',
  'pakistan',
  'egypt',
  'jordan',
  'lebanon',
  'turkey',
  'israel',
  'canada',
  'australia',
  'netherlands',
  'spain',
  'italy',
  'ireland',
  'sweden',
  'norway',
  'denmark',
  'switzerland',
  'singapore',
  'malaysia',
  'indonesia',
  'philippines',
  'nigeria',
  'south africa',
  'brazil',
  'mexico'
];

const GULF_LOCATION_ALIASES = {
  'saudi arabia': ['saudi', 'ksa', 'kingdom of saudi arabia'],
  'united arab emirates': ['uae', 'u.a.e.', 'emirates'],
  qatar: ['qatar', 'doha'],
  kuwait: ['kuwait'],
  oman: ['oman', 'muscat'],
  bahrain: ['bahrain', 'manama']
};

const GULF_CITY_TOKENS = [
  'dubai',
  'abu dhabi',
  'sharjah',
  'ajman',
  'riyadh',
  'jeddah',
  'dammam',
  'khobar',
  'doha',
  'kuwait city',
  'manama',
  'muscat'
];

function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

function isLinkedinGulfBrand(brand) {
  const slug = normalize(brand?.slug);
  if (slug === LINKEDIN_GULF_SLUG) return true;
  const name = normalize(brand?.name);
  return name === 'linkedin-gulf' || name === 'linkedin gulf';
}

function getGulfJobAllowedLocations(brand) {
  const saved = brand?.apify?.linkedinJobsDefaultInput?.locations;
  const list = Array.isArray(saved) ? saved.filter(Boolean) : [];
  return list.length > 0 ? list : [...GULF_JOB_COUNTRIES];
}

function buildMatchers(allowedLocations) {
  const matchers = new Set();
  for (const loc of allowedLocations) {
    const key = normalize(loc);
    if (!key) continue;
    matchers.add(key);
    for (const alias of GULF_LOCATION_ALIASES[key] || []) {
      matchers.add(alias);
    }
    if (key === 'uae' || key === 'united arab emirates') {
      for (const a of GULF_LOCATION_ALIASES['united arab emirates']) matchers.add(a);
      matchers.add('united arab emirates');
    }
    if (key === 'ksa' || key === 'saudi') {
      for (const a of GULF_LOCATION_ALIASES['saudi arabia']) matchers.add(a);
      matchers.add('saudi arabia');
    }
  }
  for (const city of GULF_CITY_TOKENS) {
    matchers.add(city);
  }
  return [...matchers].sort((a, b) => b.length - a.length);
}

function textMatchesMatchers(text, matchers) {
  const t = normalize(text);
  if (!t) return false;
  for (const m of matchers) {
    if (m.length < 3) continue;
    if (t.includes(m)) return true;
  }
  return false;
}

function isKnownNonGulfCountry(countryName) {
  const c = normalize(countryName);
  if (!c) return false;
  return KNOWN_NON_GULF_COUNTRIES.some((n) => c === n || c.includes(n));
}

function queryLocationMatchesGulf(item, allowedLocations) {
  const qLoc = normalize(item?.query?.location);
  if (!qLoc) return false;
  return textMatchesMatchers(qLoc, buildMatchers(allowedLocations));
}

function descriptionMentionsGulf(item, allowedLocations) {
  const text = normalize(
    [item?.descriptionText, item?.headerCaptionText].filter(Boolean).join(' ')
  );
  if (!text) return false;
  return textMatchesMatchers(text, buildMatchers(allowedLocations));
}

/**
 * True when parsed job location fields point to a Gulf country.
 */
function parsedJobLocationIsGulf(item, allowedLocations) {
  const parsed = item?.location?.parsed || {};
  const matchers = buildMatchers(allowedLocations);

  const country = normalize(parsed.country || parsed.countryFull || '');
  const countryCode = normalize(parsed.countryCode || '');
  const parsedText = normalize(parsed.text || '');
  const linkedinText = normalize(item?.location?.linkedinText || '');

  if (country && isKnownNonGulfCountry(country)) {
    return false;
  }

  if (countryCode && GULF_COUNTRY_CODES.has(countryCode)) {
    return true;
  }

  if (country && textMatchesMatchers(country, matchers)) {
    return true;
  }

  if (parsedText && textMatchesMatchers(parsedText, matchers)) {
    return true;
  }

  if (linkedinText && !NON_COUNTRY_REGION_LABELS.has(linkedinText)) {
    if (textMatchesMatchers(linkedinText, matchers)) {
      return true;
    }
  }

  const storedCountry = normalize(item?.location?.country || '');
  if (storedCountry && isKnownNonGulfCountry(storedCountry)) {
    return false;
  }
  if (storedCountry && textMatchesMatchers(storedCountry, matchers)) {
    return true;
  }

  const topCode = normalize(item?.location?.countryCode || '');
  if (topCode && GULF_COUNTRY_CODES.has(topCode) && !country) {
    return true;
  }

  return false;
}

/**
 * When LinkedIn leaves country empty but the role text + search target a Gulf market.
 */
function remoteRoleInGulfViaDescription(item, allowedLocations) {
  if (!queryLocationMatchesGulf(item, allowedLocations)) {
    return false;
  }
  if (!descriptionMentionsGulf(item, allowedLocations)) {
    return false;
  }
  const parsed = item?.location?.parsed || {};
  const country = normalize(parsed.country || parsed.countryFull || item?.location?.country || '');
  // Reject when LinkedIn parsed a specific non-Gulf country (e.g. Iceland on a KSA search hit)
  if (country && isKnownNonGulfCountry(country)) {
    return false;
  }
  // EMEA/MENA-only labels are OK when the description explicitly targets Gulf (e.g. Abu Dhabi)
  return true;
}

function companyHasGulfBase(item, allowedLocations = GULF_JOB_COUNTRIES) {
  const company = item?.company || {};
  const locations = Array.isArray(company.locations) ? company.locations : [];
  const matchers = buildMatchers(allowedLocations);

  for (const loc of locations) {
    const parsed = loc?.parsed || {};
    const countryCode = normalize(parsed.countryCode || loc?.country || '');
    const country = normalize(parsed.country || parsed.countryFull || '');
    const text = normalize(parsed.text || loc?.text || '');

    if (countryCode && GULF_COUNTRY_CODES.has(countryCode)) return true;
    if (country && textMatchesMatchers(country, matchers)) return true;
    if (text && textMatchesMatchers(text, matchers)) return true;
  }

  return false;
}

function isRemoteJob(item) {
  if (item?.workRemoteAllowed === true) return true;
  const workplaceType = normalize(item?.workplaceType || '');
  if (workplaceType === 'remote') return true;
  const text = normalize([item?.headerCaptionText, item?.descriptionText].filter(Boolean).join(' '));
  return text.includes('remote');
}

/**
 * True when:
 * 1) remote role
 * 2) company has Gulf base/HQ country
 */
function jobItemMatchesGulfLocation(item, allowedLocations = GULF_JOB_COUNTRIES) {
  if (!isRemoteJob(item)) return false;
  const companyLocations = Array.isArray(item?.company?.locations) ? item.company.locations : [];
  if (companyLocations.length === 0) return false;
  const gulfCompanyBase = companyHasGulfBase(item, allowedLocations);
  if (!gulfCompanyBase) return false;

  // Optional extra guard: if job location is explicitly non-Gulf, still drop it.
  const gulfWorkLocation =
    parsedJobLocationIsGulf(item, allowedLocations) ||
    remoteRoleInGulfViaDescription(item, allowedLocations);
  const parsedCountry = normalize(
    item?.location?.parsed?.country || item?.location?.parsed?.countryFull || item?.location?.country || ''
  );
  if (parsedCountry && isKnownNonGulfCountry(parsedCountry) && !gulfWorkLocation) {
    return false;
  }
  return true;
}

/** Map a stored LinkedinJob document back to the shape used by matchers. */
function linkedinJobToFilterItem(job) {
  return {
    descriptionText: job?.descriptionText || '',
    query: job?.query || {},
    location: {
      linkedinText: job?.location?.linkedinText || '',
      countryCode: job?.location?.countryCode || '',
      country: job?.location?.country || '',
      parsed: {
        country: job?.location?.country || '',
        countryCode: job?.location?.countryCode || '',
        text: job?.location?.linkedinText || ''
      }
    },
    company: {
      locations: Array.isArray(job?.company?.locations) ? job.company.locations : []
    }
  };
}

function storedLinkedinJobMatchesGulf(job, brand) {
  if (!isLinkedinGulfBrand(brand)) return true;
  return jobItemMatchesGulfLocation(
    linkedinJobToFilterItem(job),
    getGulfJobAllowedLocations(brand)
  );
}

/** Mongo $or clauses for Gulf job list (approximate; use with storedLinkedinJobMatchesGulf for edge cases). */
function buildLinkedinGulfMongoOr(brand) {
  const allowed = getGulfJobAllowedLocations(brand);
  const matchers = buildMatchers(allowed).filter((m) => m.length >= 3);
  const or = [
    { 'location.countryCode': { $in: ['SA', 'AE', 'QA', 'KW', 'OM', 'BH', 'sa', 'ae', 'qa', 'kw', 'om', 'bh'] } }
  ];
  for (const m of matchers) {
    const escaped = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) continue;
    or.push({ 'location.country': { $regex: escaped, $options: 'i' } });
    or.push({ 'location.linkedinText': { $regex: escaped, $options: 'i' } });
    or.push({ 'location.city': { $regex: escaped, $options: 'i' } });
  }
  return or;
}

function filterLinkedInJobsForGulf(rawItems, brand) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!isLinkedinGulfBrand(brand)) {
    return { items, dropped: 0, kept: items.length, allowedLocations: [] };
  }

  const allowed = getGulfJobAllowedLocations(brand);
  const kept = [];
  let dropped = 0;

  for (const item of items) {
    if (jobItemMatchesGulfLocation(item, allowed)) {
      kept.push(item);
    } else {
      dropped++;
    }
  }

  return { items: kept, dropped, kept: kept.length, allowedLocations: allowed };
}

module.exports = {
  LINKEDIN_GULF_SLUG,
  GULF_JOB_COUNTRIES,
  isLinkedinGulfBrand,
  getGulfJobAllowedLocations,
  jobItemMatchesGulfLocation,
  storedLinkedinJobMatchesGulf,
  buildLinkedinGulfMongoOr,
  filterLinkedInJobsForGulf
};
