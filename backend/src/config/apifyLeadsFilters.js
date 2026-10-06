/**
 * Canonical Apify actor IoSHqwTR9YGhzccez input presets.
 * Leads-Gulf uses Co-Ventech's full filters; only location/city differ.
 * fetch_count is kept low for testing (not Co-Ventech's production limit).
 */

const Brand = require('../models/Brand');

const COVENTECH_SLUG = 'co-ventech';
const LEADS_GULF_SLUG = 'leads-gulf';

/** Max leads per Apify run for Leads-Gulf (testing). Change here when ready for production. */
const LEADS_GULF_TEST_FETCH_COUNT = 20;

const GULF_CONTACT_LOCATIONS = [
  'saudi arabia',
  'united arab emirates',
  'kuwait',
  'qatar',
  'bahrain',
  'oman'
];

const GULF_CONTACT_CITIES = [
  'Dubai',
  'Abu Dhabi',
  'Sharjah',
  'Riyadh',
  'Jeddah',
  'Dammam',
  'Doha',
  'Kuwait City',
  'Manama',
  'Muscat'
];

/** Fallback when Co-Ventech has no saved defaultInput in DB. */
const COVENTECH_LEADS_DEFAULT_INPUT = {
  company_industry: [
    'computer software',
    'information technology & services',
    'financial services',
    'computer & network security',
    'health, wellness & fitness',
    'information services'
  ],
  company_keywords: [
    'SaaS', 'B2B', 'B2B SaaS', 'AI', 'AI Development', 'Enterprise Software', 'fintech', 'healthtech', 'Edtech',
    'marketplace', 'platform', 'API', 'cloud', 'QA', 'Devops', 'Web Development', 'Web development',
    'Cybersecurity', 'Testing', 'Automation', 'Test Automation'
  ],
  contact_city: [
    'San Francisco Bay Area', 'New York', 'Austin', 'Seattle', 'Boston', 'Denver', 'Chicago',
    'Atlanta', 'Dallas', 'Los Angeles', 'Miami'
  ],
  contact_job_title: [
    'CTO', 'Chief Technology Officer', 'CEO', 'VP of Engineering', 'Head of Engineering',
    'Co-Founder', 'Technical Co-Founder',
    'Director of QA', 'QA Director', 'Head of QA', 'QA Manager', 'Quality Engineering Manager',
    'Director of Quality Engineering', 'Engineering Manager', 'Director of Engineering',
    'Director of Software Engineering', 'Test Automation Lead', 'SDET Manager'
  ],
  contact_location: ['united states'],
  contact_not_job_title: ['Sales', 'Marketing', 'Customer Support', 'Intern'],
  email_status: ['validated'],
  fetch_count: 100,
  file_name: 'Co-Ventech Auto-Scrape',
  functional_level: ['c_suite', 'engineering', 'information_technology'],
  funding: ['angel', 'seed', 'series_a', 'series_b', 'series_c'],
  max_revenue: '5M',
  seniority_level: ['c_suite', 'founder', 'owner', 'director', 'vp', 'manager', 'head'],
  size: ['1-10', '11-20', '21-50', '51-100', '101-200', '201-500']
};

function toPlainObject(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return obj.toObject?.() || obj;
}

function getSavedDefaultInput(brandDoc) {
  return toPlainObject(brandDoc?.apify?.defaultInput);
}

/** Co-Ventech production limit: apify.fetchCount, else defaultInput.fetch_count. */
function getFetchCountFromBrand(brandDoc) {
  if (!brandDoc?.apify) return COVENTECH_LEADS_DEFAULT_INPUT.fetch_count;
  const saved = getSavedDefaultInput(brandDoc);
  const count = brandDoc.apify.fetchCount ?? saved.fetch_count;
  return count && count >= 1 ? count : COVENTECH_LEADS_DEFAULT_INPUT.fetch_count;
}

/**
 * Low fetch cap for Leads-Gulf dev/test.
 * Ignores brand.apify.fetchCount when it is 100+ (usually copied from Co-Ventech prod).
 */
function getLeadsGulfFetchCount(_brandDoc, opts = {}) {
  if (opts.fetchCountOverride != null && opts.fetchCountOverride >= 1) {
    return Math.min(opts.fetchCountOverride, 1000);
  }
  return LEADS_GULF_TEST_FETCH_COUNT;
}

/** Remove fetch_count so Co-Ventech prod value (100/500) never leaks into Gulf runs. */
function omitFetchCount(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const { fetch_count, ...rest } = toPlainObject(obj);
  return rest;
}

async function loadCoVentechBrand() {
  return Brand.findOne({ slug: COVENTECH_SLUG }).select('slug apify name');
}

/**
 * Build actor input for a brand.
 * @param {object} brand - target brand mongoose doc
 * @param {object} opts - { sourceBrand?, requestOverrides?, fetchCountOverride? }
 */
function buildApifyLeadsInput(brand, opts = {}) {
  const slug = (brand.slug || '').toLowerCase();
  const isGulf = slug === LEADS_GULF_SLUG;
  const sourceBrand = opts.sourceBrand || null;

  const savedObj = getSavedDefaultInput(brand);
  const requestOverrides = opts.requestOverrides && typeof opts.requestOverrides === 'object'
    ? opts.requestOverrides
    : {};

  // Base template: code defaults + Co-Ventech DB filters (when Gulf or when source passed)
  const coventechSaved = sourceBrand
    ? getSavedDefaultInput(sourceBrand)
    : (slug === COVENTECH_SLUG ? savedObj : {});

  const template = {
    ...omitFetchCount(COVENTECH_LEADS_DEFAULT_INPUT),
    ...omitFetchCount(coventechSaved)
  };

  let input;
  if (isGulf) {
    // Gulf: Co-Ventech filters only; fetch_count always from test cap (never 100/500 from prod)
    const gulfOverrides = omitFetchCount(requestOverrides);
    input = { ...template, ...omitFetchCount(savedObj), ...gulfOverrides };
    input.contact_location = [...GULF_CONTACT_LOCATIONS];
    input.contact_city = [...GULF_CONTACT_CITIES];
    input.file_name = gulfOverrides.file_name
      || (savedObj.file_name && savedObj.file_name !== 'Prospects' ? savedObj.file_name : 'Leads-Gulf Auto-Scrape');
    input.fetch_count = getLeadsGulfFetchCount(brand, opts);
  } else {
    input = { ...template, ...savedObj, ...requestOverrides };
    if (brand.apify?.fetchCount) {
      input.fetch_count = brand.apify.fetchCount;
    }
  }

  if (!isGulf && opts.fetchCountOverride) {
    input.fetch_count = opts.fetchCountOverride;
  }

  if (!input.fetch_count || input.fetch_count < 1) {
    input.fetch_count = isGulf ? LEADS_GULF_TEST_FETCH_COUNT : COVENTECH_LEADS_DEFAULT_INPUT.fetch_count;
  }
  const maxCap = isGulf ? 100 : 1000;
  if (input.fetch_count > maxCap) {
    input.fetch_count = maxCap;
  }

  // Final guard: Gulf must never send prod fetch_count by mistake
  if (isGulf && input.fetch_count > 50) {
    input.fetch_count = getLeadsGulfFetchCount(brand, opts);
  }

  return input;
}

/** Loads Co-Ventech from DB when building input for Leads-Gulf. */
async function buildApifyLeadsInputForBrand(brand, opts = {}) {
  const slug = (brand.slug || '').toLowerCase();
  if (slug === LEADS_GULF_SLUG && !opts.sourceBrand) {
    const sourceBrand = await loadCoVentechBrand();
    return buildApifyLeadsInput(brand, { ...opts, sourceBrand });
  }
  return buildApifyLeadsInput(brand, opts);
}

async function getLeadsGulfDefaultInput() {
  const sourceBrand = await loadCoVentechBrand();
  const input = buildApifyLeadsInput(
    { slug: LEADS_GULF_SLUG, apify: { fetchCount: 100 } },
    { sourceBrand }
  );
  input.fetch_count = getLeadsGulfFetchCount({ slug: LEADS_GULF_SLUG, apify: {} });
  return input;
}

module.exports = {
  COVENTECH_SLUG,
  LEADS_GULF_SLUG,
  LEADS_GULF_TEST_FETCH_COUNT,
  COVENTECH_LEADS_DEFAULT_INPUT,
  GULF_CONTACT_LOCATIONS,
  GULF_CONTACT_CITIES,
  buildApifyLeadsInput,
  buildApifyLeadsInputForBrand,
  getLeadsGulfDefaultInput,
  getFetchCountFromBrand,
  getLeadsGulfFetchCount,
  loadCoVentechBrand
};
