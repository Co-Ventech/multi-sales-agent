/**
 * twitterJobsService.js
 *
 * Calls the Twitter Jobs Search Scraper actor on Apify and maps results to TwitterJob fields.
 * Actor: powerai~twitter-jobs-search-scraper
 * API endpoint: POST https://api.apify.com/v2/acts/powerai~twitter-jobs-search-scraper/runs
 */

const { ApifyClient } = require('apify-client');

/**
 * Build Apify actor input. keyword, maxResults, jobLocationType from UI (defaults to remote).
 * @param {{ keyword: string, maxResults: number, jobLocationType?: string }} params
 */
/** Only these keys are sent to the Twitter jobs actor (no jobLocationId). */
const TWITTER_JOBS_ACTOR_INPUT_KEYS = ['keyword', 'maxResults', 'jobLocationType'];

function buildTwitterJobsActorInput({ keyword, maxResults, jobLocationType }) {
  const max = Math.min(Math.max(20, parseInt(maxResults, 10) || 20), 1000);
  const locType = String(jobLocationType || '').trim().toLowerCase() || 'remote';
  return {
    keyword: String(keyword || '').trim(),
    maxResults: max,
    jobLocationType: locType
  };
}

/** Drop legacy/extra fields — never forward jobLocationId from request or DB. */
function sanitizeTwitterActorInput(input) {
  const built = buildTwitterJobsActorInput(input);
  return {
    keyword: built.keyword,
    maxResults: built.maxResults,
    jobLocationType: built.jobLocationType
  };
}

/**
 * Run the Twitter Jobs Search Scraper actor and return raw items.
 * @param {string} apiToken
 * @param {string} actorId
 * @param {object} input  — see buildTwitterJobsActorInput()
 * @returns {Array} raw items
 */
async function runActor(apiToken, actorId, input) {
  const client = new ApifyClient({ token: apiToken });
  const actorInput = sanitizeTwitterActorInput(input);

  const run = await client.actor(actorId).call(actorInput, { waitSecs: 300 });

  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Apify actor finished with status: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items || [];
}

// ── Country filter ─────────────────────────────────────────────────────────────
// ALLOWED countries: US, Canada, UK, EU (Germany/France/Italy/etc.), UAE, KSA
// BLOCKED countries: Pakistan, India, Bangladesh, Sri Lanka, Nepal, etc.
// Remote jobs with no location are always allowed.

function buildRegex(patterns) {
  return new RegExp('\\b(' + patterns.join('|') + ')\\b', 'i');
}

const ALLOWED_PATTERNS = [
  'united states', 'usa', 'u\\.s\\.a', 'america', 'us-based', 'stateside',
  'canada', 'canadian',
  'united kingdom', 'uk\\b', 'england', 'britain', 'british', 'london\\b',
  'germany', 'deutschland', 'german', 'berlin', 'munich', 'hamburg', 'frankfurt',
  'france', 'french', 'paris', 'lyon', 'marseille',
  'italy', 'italian', 'rome', 'milan', 'turin',
  'spain', 'spanish', 'madrid', 'barcelona',
  'netherlands', 'dutch', 'amsterdam', 'rotterdam',
  'belgium', 'belgian', 'brussels',
  'switzerland', 'swiss', 'zurich', 'geneva',
  'austria', 'austrian', 'vienna',
  'poland', 'polish', 'warsaw',
  'sweden', 'swedish', 'stockholm',
  'norway', 'norwegian', 'oslo',
  'denmark', 'danish', 'copenhagen',
  'finland', 'finnish', 'helsinki',
  'portugal', 'portuguese', 'lisbon',
  'ireland', 'irish', 'dublin',
  'czech', 'czechia', 'prague',
  'hungary', 'hungarian', 'budapest',
  'romania', 'romanian', 'bucharest',
  'greece', 'greek', 'athens',
  'uae', 'united arab emirates', 'emirati', 'dubai', 'abu dhabi', 'sharjah', 'ajman',
  'saudi', 'ksa', 'kingdom of saudi', 'riyadh', 'jeddah', 'mecca', 'dammam',
  'swiss'
];

const BLOCKED_PATTERNS = [
  'pakistan', 'pakistani', 'pk\\b', 'islamabad', 'karachi', 'lahore', 'kpk', 'baluchistan',
  'india', 'indian', 'in\\b', 'delhi', 'mumbai', 'bangalore', 'hyderabad', 'chennai',
  'bangladesh', 'bangladeshi', 'dhaka', 'chittagong',
  'sri lanka', 'sri lankan', 'colombo',
  'nepal', 'nepali', 'kathmandu',
  'afghanistan', 'afghan',
  'iraq', 'iraqi', 'baghdad',
  'iran', 'iranian', 'tehran',
  'syria', 'syrian', 'damascus',
  'yemen', 'yemeni', 'sanaa',
  'libya', 'libyan', 'tripoli',
  'sudan', 'sudanese', 'south sudan',
  'somalia', 'somali', 'mogadishu',
  'nigeria', 'nigerian', 'lagos', 'abuja',
  'kenya', 'kenyan', 'nairobi',
  'egypt', 'egyptian', 'cairo',
  'jordan', 'jordanian', 'amman',
  'lebanon', 'lebanese', 'beirut',
  'turkey', 'turkish', 'istanbul', 'ankara'
];

const ALLOWED_REGEX = buildRegex(ALLOWED_PATTERNS);
const BLOCKED_REGEX = buildRegex(BLOCKED_PATTERNS);

/**
 * Returns true if the location string is allowed (US, Canada, UK, EU, UAE, KSA).
 * Returns true for "Remote" / empty locations.
 * Returns false if location matches a blocked country.
 */
function isAllowedLocation(location) {
  if (!location || location.trim() === '') return true;
  if (/remote/i.test(location)) return true;

  if (BLOCKED_REGEX.test(location)) return false;
  if (ALLOWED_REGEX.test(location)) return true;

  return false;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function isUnknownCompanyName(name) {
  const n = normalizeText(name).toLowerCase();
  if (!n) return true;
  return (
    n === 'unknown' ||
    n === 'unknown company' ||
    n === 'n/a' ||
    n === 'na' ||
    n === '-' ||
    n === '—' ||
    n === '–'
  );
}

function isPlaceholderTitle(title) {
  const t = normalizeText(title);
  if (!t) return true;
  return t === '-' || t === '—' || t === '–';
}

/**
 * Jobs without a real title and company are not stored or shown.
 */
function isRelevantTwitterJob(job) {
  if (!job?.rest_id && !job?.job_listing_id) return false;
  if (isPlaceholderTitle(job.title)) return false;
  if (isUnknownCompanyName(job.companyName)) return false;
  return true;
}

function normalizeUrl(url) {
  return normalizeText(url).toLowerCase().replace(/\/$/, '').split('?')[0];
}

/**
 * Stable identity for the same job listing (handles different rest_ids from Apify).
 */
function buildTwitterJobDedupeKey(job) {
  if (job?.dedupeKey) return job.dedupeKey;

  const redirect = normalizeUrl(job?.redirectUrl);
  if (redirect) return `url:${redirect}`;

  const listingId = normalizeText(job?.job_listing_id || job?.rest_id);
  if (listingId) return `listing:${listingId}`;

  const title = normalizeText(job?.title).toLowerCase();
  const company = normalizeText(job?.companyName).toLowerCase();
  const loc = normalizeText(job?.location).toLowerCase();
  return `tc:${company}|${title}|${loc}`;
}

function attachDedupeKey(job) {
  return { ...job, dedupeKey: buildTwitterJobDedupeKey(job) };
}

/** Keep newest scrapedAt per dedupeKey. */
function dedupeTwitterJobs(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    const key = buildTwitterJobDedupeKey(job);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, job);
      continue;
    }
    const prevAt = prev.scrapedAt ? new Date(prev.scrapedAt).getTime() : 0;
    const at = job.scrapedAt ? new Date(job.scrapedAt).getTime() : 0;
    if (at >= prevAt) byKey.set(key, job);
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.scrapedAt || 0) - new Date(a.scrapedAt || 0)
  );
}

function buildExistingDedupeKeySet(existingJobs) {
  const set = new Set();
  for (const job of existingJobs) {
    set.add(buildTwitterJobDedupeKey(job));
  }
  return set;
}

/** Mongo filter matching isRelevantTwitterJob for list queries. */
function relevantJobsMongoFilter() {
  return {
    title: { $exists: true, $type: 'string', $regex: /\S/ },
    companyName: {
      $exists: true,
      $type: 'string',
      $regex: /\S/,
      $not: /^unknown(\s+company)?$/i
    }
  };
}

/**
 * Map a raw Apify Twitter Jobs item to TwitterJob model fields.
 * Filters out blocked locations and irrelevant/unknown listings.
 */
function mapToJobs(items) {
  const results = [];
  const seenKeys = new Set();
  let skippedBlocked = 0;
  let skippedIrrelevant = 0;
  let skippedDuplicate = 0;

  for (const item of items) {
    const rawLocation = item.core?.location || item.location || '';

    if (!isAllowedLocation(rawLocation)) {
      skippedBlocked++;
      continue;
    }

    // Navigate the nested structure
    const companyProfile = item.company_profile_results?.result || item.company_profile_results || {};
    const companyCore = companyProfile.core || {};
    const companyLogo = companyProfile.logo || {};

    const userProfile = item.user_results?.result || item.user_results || {};
    const userLegacy = userProfile.legacy || {};

    const core = item.core || {};

    const mapped = {
      rest_id:         item.rest_id || item.job_listing_id || null,
      job_listing_id:  item.job_listing_id || null,
      keyword:         item.keyword || null,
      jobLocationType:
        item.jobLocationType ||
        item.core?.jobLocationType ||
        item.core?.job_location_type ||
        null,

      companyName:    companyCore.name || companyProfile.name || null,
      companyDomain:  null,
      companyLogo:    companyLogo.normal_url || companyLogo.url || null,

      title:        core.title || item.title || null,
      location:     core.location || item.location || null,
      redirectUrl:   core.redirect_url || item.redirect_url || core.url || null,

      salaryCurrency:   core.salary_currency_code || null,
      salaryMin:        core.salary_min != null ? Number(core.salary_min) : null,
      salaryMax:        core.salary_max != null ? Number(core.salary_max) : null,
      salaryInterval:   core.salary_interval != null ? Number(core.salary_interval) : null,
      formattedSalary: core.formatted_salary || null,

      posterName:        userLegacy.name || null,
      posterScreenName:  userLegacy.screen_name || null,
      posterProfileUrl:  userLegacy.profile_image_url_https || null,
      posterVerified:    !!userLegacy.verified,

      scrapedAt: item.scrapedAt ? new Date(item.scrapedAt) : new Date()
    };

    if (!isRelevantTwitterJob(mapped)) {
      skippedIrrelevant++;
      continue;
    }

    const withKey = attachDedupeKey(mapped);
    if (seenKeys.has(withKey.dedupeKey)) {
      skippedDuplicate++;
      continue;
    }
    seenKeys.add(withKey.dedupeKey);
    results.push(withKey);
  }

  console.log(
    `[TwitterJobs] Filter: ${skippedBlocked} blocked location, ${skippedIrrelevant} irrelevant, ${skippedDuplicate} duplicate, ${results.length} kept`
  );
  return results;
}

module.exports = {
  runActor,
  buildTwitterJobsActorInput,
  sanitizeTwitterActorInput,
  mapToJobs,
  buildTwitterJobDedupeKey,
  attachDedupeKey,
  dedupeTwitterJobs,
  buildExistingDedupeKeySet,
  isAllowedLocation,
  isRelevantTwitterJob,
  relevantJobsMongoFilter
};