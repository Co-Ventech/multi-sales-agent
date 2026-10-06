const {
  getUpworkAllowedLocations,
  shouldFilterUpworkByLocation
} = require('./apifyUpworkLocationFilters');

/**
 * Single source for Apify API token — always prefer APIFY_API_TOKEN from .env.
 * Brand-level tokens are optional overrides only when env is not set.
 */
function getApifyToken(brand, requestToken) {
  if (process.env.APIFY_API_TOKEN) return process.env.APIFY_API_TOKEN;
  if (requestToken && requestToken !== '••••••••') return requestToken;
  if (brand?.apify?.apiToken) return brand.apify.apiToken;
  if (brand?.twitterJobs?.apiToken) return brand.twitterJobs.apiToken;
  return null;
}

function requireApifyToken(brand, requestToken) {
  const token = getApifyToken(brand, requestToken);
  if (!token) {
    throw new Error(
      'No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env (recommended) or brand Apify settings.'
    );
  }
  return token;
}

/** Hard cap for total jobs returned from LinkedIn / full Upwork pipeline. */
const MAX_JOB_SCRAPE_ITEMS = Math.min(
  100,
  Math.max(1, Number(process.env.APIFY_MAX_JOB_ITEMS) || 25)
);

/** Upwork Job Scraper page (+ Scrape Jobs) — lower limit for faster runs. */
const MAX_UPWORK_SCRAPER_ITEMS = Math.min(
  MAX_JOB_SCRAPE_ITEMS,
  Math.max(1, Number(process.env.APIFY_UPWORK_SCRAPER_MAX_ITEMS) || 10)
);

/** LinkedIn actor runs one Apify search per (jobTitle × location). */
const MAX_LINKEDIN_LOCATIONS = Math.max(
  1,
  Number(process.env.APIFY_MAX_LINKEDIN_LOCATIONS) || 4
);

/**
 * LinkedIn-only target item budget (per run) used when the brand default input
 * has no maxItems and no env override raises the global cap. Kept above the
 * global MAX_JOB_SCRAPE_ITEMS so the LinkedIn default pool is large enough to
 * guarantee 5-10 items per (title × location) query. Does NOT affect Upwork.
 */
const LINKEDIN_JOBS_DEFAULT_MAX_ITEMS = 100;

/** Max distinct companies per run sent to LinkedIn Employees actor (non-Gulf brands). */
const MAX_LINKEDIN_EMPLOYEE_COMPANIES_DEFAULT = Math.max(
  1,
  Number(process.env.APIFY_MAX_LINKEDIN_EMPLOYEE_COMPANIES) || 5
);

/**
 * Default LinkedIn job regions when brand has no linkedinJobsDefaultInput.locations.
 * Kept to the 2 top target regions so the per-query budget (LINKEDIN_JOBS_DEFAULT_MAX_ITEMS)
 * yields ~7 items/query across the 7 default job titles instead of spreading
 * the budget across 4 regions (~1 item/query).
 */
const DEFAULT_LINKEDIN_JOB_LOCATIONS = [
  'Saudi Arabia',
  'United Arab Emirates'
];

/** Fallback for Upwork job scraper when brand has no location preset. */
const JOB_SCRAPER_UPWORK_LOCATIONS = [
  'United States',
  'United Kingdom',
  'Saudi Arabia',
  'United Arab Emirates'
];

/** Use brand saved locations when set; otherwise default 4-region list. */
function resolveLinkedinJobLocations(savedLocations) {
  const list = Array.isArray(savedLocations) ? savedLocations.filter(Boolean) : [];
  return list.length > 0 ? list : DEFAULT_LINKEDIN_JOB_LOCATIONS;
}

function normalizeLocationList(loc) {
  if (loc == null || loc === '') return [];
  return Array.isArray(loc) ? loc.filter(Boolean) : [loc];
}

/**
 * Resolve Upwork actor location[].
 * Standard upwork always includes US, UK, Saudi Arabia, UAE (merged with brand preset).
 * Gulf upwork merges GCC list with brand preset. Other brands keep input as-is.
 */
function applyUpworkJobLocations(input = {}, brand = null) {
  const fromInput = normalizeLocationList(input.location);

  if (brand && shouldFilterUpworkByLocation(brand)) {
    const saved =
      fromInput.length > 0 ? fromInput : normalizeLocationList(brand.apify?.defaultInput?.location);
    const syntheticBrand = {
      ...brand,
      apify: {
        ...brand.apify,
        defaultInput: { ...brand.apify?.defaultInput, location: saved }
      }
    };
    return { ...input, location: getUpworkAllowedLocations(syntheticBrand) };
  }

  if (fromInput.length > 0) return input;
  return { ...input, location: [...JOB_SCRAPER_UPWORK_LOCATIONS] };
}

/**
 * Upwork / single-query actors: maxItems is the total run limit.
 */
function capJobScrapeInput(input, maxItems = MAX_JOB_SCRAPE_ITEMS) {
  const base = input && typeof input === 'object' ? { ...input } : {};
  const cap = Math.min(MAX_JOB_SCRAPE_ITEMS, Math.max(1, maxItems));
  const requested = base.maxItems != null ? Number(base.maxItems) : cap;
  base.maxItems = Math.min(
    cap,
    Math.max(1, Number.isFinite(requested) ? requested : cap)
  );
  return base;
}

/**
 * Upwork Jobs actor (XYTgO05GT5qAoSlxy) uses per_page — not maxItems.
 * Brand defaultInput often has per_page: 50; always enforce scraper cap last.
 */
function capUpworkScraperInput(input) {
  const base = input && typeof input === 'object' ? { ...input } : {};
  const max = MAX_UPWORK_SCRAPER_ITEMS;
  base.per_page = max;
  base.maxItems = max;
  return base;
}

/** Full Upwork enrichment pipeline — cap per_page to global job limit. */
function capUpworkPipelineInput(input) {
  const base = input && typeof input === 'object' ? { ...input } : {};
  const max = MAX_JOB_SCRAPE_ITEMS;
  const requested = Number(base.per_page);
  base.per_page = Math.min(max, Number.isFinite(requested) && requested > 0 ? requested : max);
  base.maxItems = max;
  return base;
}

/**
 * LinkedIn Jobs actor (harvestapi): maxItems applies per (title × location) search.
 * Split the LinkedIn budget so the run stays near the LinkedIn target total
 * (LINKEDIN_JOBS_DEFAULT_MAX_ITEMS) — never the smaller global Upwork cap — so
 * each query can request 5-10 items. Upwork budget is unaffected.
 */
function buildLinkedInJobsActorInput(input, maxTotalOverride) {
  const base = input && typeof input === 'object' ? { ...input } : {};
  const titles = [...(base.jobTitles || base.searchQueries || [])].filter(Boolean);
  const cappedLocations = resolveLinkedinJobLocations(base.locations);

  const savedMax = Number(base.maxItems);
  const linkedinCap = Math.max(MAX_JOB_SCRAPE_ITEMS, LINKEDIN_JOBS_DEFAULT_MAX_ITEMS);
  const maxTotal = maxTotalOverride ?? (
    Number.isFinite(savedMax) && savedMax > 0
      ? Math.min(savedMax, linkedinCap)
      : linkedinCap
  );

  const queryCount = Math.max(1, titles.length * cappedLocations.length);
  const perQueryMax = Math.max(1, Math.floor(maxTotal / queryCount));

  const out = {
    ...base,
    jobTitles: titles,
    searchQueries: titles,
    locations: cappedLocations,
    maxItems: perQueryMax
  };

  out._scrapeMeta = {
    maxTotal,
    queryCount,
    perQueryMax,
    locationsUsed: cappedLocations.length,
    titlesUsed: titles.length,
    locations: cappedLocations
  };

  return out;
}

module.exports = {
  getApifyToken,
  requireApifyToken,
  MAX_JOB_SCRAPE_ITEMS,
  MAX_UPWORK_SCRAPER_ITEMS,
  MAX_LINKEDIN_LOCATIONS,
  MAX_LINKEDIN_EMPLOYEE_COMPANIES_DEFAULT,
  LINKEDIN_JOBS_DEFAULT_MAX_ITEMS,
  DEFAULT_LINKEDIN_JOB_LOCATIONS,
  JOB_SCRAPER_UPWORK_LOCATIONS,
  resolveLinkedinJobLocations,
  applyUpworkJobLocations,
  capJobScrapeInput,
  capUpworkScraperInput,
  capUpworkPipelineInput,
  buildLinkedInJobsActorInput
};
