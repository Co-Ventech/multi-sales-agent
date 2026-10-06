/**
 * apifyJobDomainFilters.js
 *
 * Post-filter scraped jobs (LinkedIn Jobs actor, Upwork Jobs actor, Upwork MCP)
 * so only roles in the target tech domains are stored. Runs on title + description
 * using word-boundary keyword matching, mirroring the existing location-filter
 * pattern (see apifyLinkedinLocationFilters.js / apifyUpworkLocationFilters.js).
 *
 * Two matching modes:
 *   - default (Upwork / Upwork MCP): job passes when its title OR description
 *     matches a target domain. Unchanged legacy behavior.
 *   - titleStrict (LinkedIn): title-first. A title that matches a known
 *     non-domain keyword (Finance, Biomedical, Sales, ...) is rejected
 *     immediately; otherwise a positive TITLE match against one of the 5 tech
 *     domains is required to keep the job — a tech-sounding description can no
 *     longer pass a clearly non-tech title.
 *
 * Read-only with respect to the DB: it never touches stored jobs, it only decides
 * which raw items from the scraper are passed on for upsert.
 */

const { isLinkedinStandardBrand } = require('./apifyLinkedinLocationFilters');
const { isLinkedinGulfBrand } = require('./apifyLinkedinGulfFilters');
const { isUpworkStandardBrand, isUpworkGulfBrand } = require('./apifyUpworkLocationFilters');

const UPWORK_MCP_SLUG = 'upwork-mcp';

const DOMAIN_KEYWORDS = [
  {
    id: 'software-development',
    name: 'Software Development',
    keywords: [
      'software engineer',
      'software developer',
      'software engineering',
      'software development',
      'full stack',
      'fullstack',
      'frontend developer',
      'front-end developer',
      'front end developer',
      'frontend engineer',
      'backend developer',
      'back-end developer',
      'back end developer',
      'backend engineer',
      'web developer',
      'web development',
      'web dev',
      'mobile developer',
      'mobile app developer',
      'android developer',
      'ios developer',
      'react native developer',
      'application developer',
      'app developer',
      'java developer',
      'python developer',
      '.net developer',
      'php developer',
      'node.js developer',
      'nodejs developer',
      'ruby developer',
      'golang developer',
      'javascript developer',
      'typescript developer',
      'react developer',
      'angular developer',
      'vue developer',
      'software development engineer',
      'sde'
    ]
  },
  {
    id: 'qa-test-automation',
    name: 'QA & Test Automation',
    keywords: [
      'qa engineer',
      'qa tester',
      'qa analyst',
      'qa lead',
      'qa manager',
      'quality assurance',
      'quality engineer',
      'quality engineering',
      'test engineer',
      'software tester',
      'software testing',
      'automation tester',
      'automation engineer',
      'test automation',
      'test lead',
      'manual tester',
      'test architect',
      'sdet'
    ]
  },
  {
    id: 'devops',
    name: 'DevOps',
    keywords: [
      'devops',
      'dev ops',
      'site reliability',
      'sre',
      'ci/cd',
      'ci cd',
      'cloud engineer',
      'cloud architect',
      'cloud infrastructure',
      'infrastructure engineer',
      'platform engineer',
      'kubernetes',
      'docker',
      'terraform',
      'ansible',
      'release engineer',
      'systems engineer',
      'aws engineer',
      'azure engineer',
      'gcp engineer'
    ]
  },
  {
    id: 'cybersecurity',
    name: 'Cybersecurity',
    keywords: [
      'security engineer',
      'security architect',
      'security analyst',
      'security consultant',
      'security specialist',
      'cybersecurity',
      'cyber security',
      'cyber-security',
      'cyber defense',
      'infosec',
      'information security',
      'penetration tester',
      'penetration testing',
      'pentest',
      'pen tester',
      'red team',
      'offensive security',
      'soc analyst',
      'security operations',
      'security operations center',
      'incident response',
      'vulnerability',
      'application security',
      'network security',
      'cloud security',
      'devsecops',
      'ethical hacker',
      'security researcher'
    ]
  },
  {
    id: 'ai-generative',
    name: 'AI Generative Solutions',
    keywords: [
      'ai engineer',
      'ai developer',
      'ai architect',
      'ai researcher',
      'ai ml',
      'ai/ml',
      'ai/machine learning',
      'artificial intelligence',
      'machine learning',
      'ml engineer',
      'deep learning',
      'data scientist',
      'data science',
      'data engineer',
      'generative ai',
      'gen ai',
      'genai',
      'llm',
      'large language model',
      'llm engineer',
      'prompt engineer',
      'computer vision',
      'nlp',
      'natural language processing',
      'mlops',
      'aiops'
    ]
  }
];

/** Precompiled word-boundary patterns per domain, built once at load. */
const DOMAIN_PATTERNS = DOMAIN_KEYWORDS.map((entry) => ({
  id: entry.id,
  name: entry.name,
  patterns: entry.keywords.map(buildDomainPattern)
}));

/**
 * Job titles that must NEVER be stored, even when the job description happens to
 * mention tech terms. Checked against the title only, and only in titleStrict
 * (LinkedIn) mode. Word-boundary matching means "sales" does not match
 * "Salesforce" and "scientist" is deliberately absent so "Data Scientist" passes.
 */
const NON_DOMAIN_TITLE_KEYWORDS = [
  // Finance / accounting
  'finance', 'financial', 'accountant', 'accounting', 'bookkeeper', 'bookkeeping',
  'payroll', 'auditor', 'banker', 'broker', 'treasury',
  // Healthcare / biomedical / life sciences
  'biomedical', 'biotech', 'pharmaceutical', 'pharma', 'clinical', 'nurse', 'nursing',
  'doctor', 'dentist', 'pharmacist', 'veterinarian', 'radiologist', 'biologist', 'chemist',
  // Technician / lab / field roles
  'technician', 'laboratory', 'lab assistant',
  // Sales / marketing / business
  'sales', 'marketing', 'advertising', 'social media', 'seo', 'business development',
  'account executive', 'account manager', 'inside sales',
  // HR / admin / support
  'recruiter', 'human resources', 'hr', 'talent acquisition', 'administrative',
  'secretary', 'receptionist', 'office manager', 'executive assistant',
  'customer service', 'customer support', 'call center', 'helpdesk', 'support agent',
  // Legal
  'lawyer', 'attorney', 'legal', 'paralegal', 'compliance officer',
  // Content / creative (non-dev)
  'content writer', 'copywriter', 'editor', 'journalist', 'translator', 'interpreter',
  'proofreader', 'graphic designer', 'ui designer', 'ux designer', 'product designer',
  'interior designer', 'designer',
  // Ops / delivery (non-dev)
  'data entry', 'operations manager', 'project manager', 'program manager',
  'product manager', 'scrum master', 'product owner', 'delivery manager',
  // Engineering (non-software)
  'civil engineer', 'mechanical engineer', 'electrical engineer', 'chemical engineer',
  'structural engineer', 'industrial engineer', 'aerospace engineer', 'biomedical engineer',
  'environmental engineer', 'geotechnical engineer',
  // Analytics (non-tech)
  'data analyst', 'business analyst', 'financial analyst', 'credit analyst',
  'risk analyst', 'actuary', 'underwriter',
  // Trades / services
  'electrician', 'plumber', 'welder', 'carpenter', 'driver', 'delivery driver',
  'logistics', 'warehouse', 'inventory', 'retail', 'cashier', 'store manager',
  'security guard', 'photographer', 'videographer', 'video editor',
  // Food / hospitality
  'cook', 'chef', 'bartender', 'waiter', 'hostess'
];

/** Precompiled word-boundary patterns for the non-domain title blocklist. */
const NON_DOMAIN_TITLE_PATTERNS = NON_DOMAIN_TITLE_KEYWORDS.map(buildDomainPattern);

function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

/**
 * Escape a keyword and build a word-boundary RegExp that:
 *  - tolerates whitespace/hyphen/slash separators between words ("full-stack", "full stack"),
 *  - tolerates a trailing plural on the last word ("qa engineers"),
 *  - does not anchor on a leading \b when the keyword starts with a non-word char (".net").
 */
function buildDomainPattern(keyword) {
  const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = escaped.split(/\s+/).filter(Boolean);
  if (words.length === 0) return new RegExp('$^');
  const last = words[words.length - 1];
  words[words.length - 1] = `${last}s?`;
  const core = words.join('[\\s\\-/]+');
  const leading = /^[a-z0-9]/.test(keyword) ? '\\b' : '(?:^|[^a-z0-9])';
  return new RegExp(`${leading}${core}\\b`, 'i');
}

function textMatchesPatterns(text, patterns) {
  const t = normalize(text);
  if (!t) return false;
  for (const re of patterns) {
    if (re.test(t)) return true;
  }
  return false;
}

/** Collect searchable text from any raw job item (LinkedIn / Upwork / Upwork MCP). */
function extractJobText(item) {
  return {
    title: normalize(
      item?.title ||
      item?.jobTitle ||
      item?.position ||
      item?.name ||
      ''
    ),
    description: normalize(
      item?.descriptionText ||
      item?.description ||
      item?.headerCaptionText ||
      ''
    )
  };
}

/** True when the job title or description matches at least one target domain. */
function jobMatchesAnyDomain(item) {
  const { title, description } = extractJobText(item);
  for (const entry of DOMAIN_PATTERNS) {
    if (textMatchesPatterns(title, entry.patterns)) return true;
    if (textMatchesPatterns(description, entry.patterns)) return true;
  }
  return false;
}

/** First domain matched by a job, or null when it matches none. */
function getMatchedDomain(item) {
  const { title, description } = extractJobText(item);
  for (const entry of DOMAIN_PATTERNS) {
    if (textMatchesPatterns(title, entry.patterns)) return entry.name;
    if (textMatchesPatterns(description, entry.patterns)) return entry.name;
  }
  return null;
}

/**
 * Brand check — defaults to true for LinkedIn (standard + Gulf), Upwork
 * (standard + Gulf), and Upwork-MCP brands, including any brand whose
 * apify.provider is 'mcp'.
 */
function shouldFilterByDomain(brand) {
  if (!brand || typeof brand !== 'object') return false;
  if (brand.apify?.provider === 'mcp') return true;
  if (isLinkedinStandardBrand(brand) || isLinkedinGulfBrand(brand)) return true;
  if (isUpworkStandardBrand(brand) || isUpworkGulfBrand(brand)) return true;
  const slug = normalize(brand?.slug);
  const name = normalize(brand?.name);
  return slug === UPWORK_MCP_SLUG || name === UPWORK_MCP_SLUG || name === 'upwork mcp';
}

/** True when the job title matches a known non-domain keyword. */
function titleMatchesNonDomain(title) {
  return textMatchesPatterns(title, NON_DOMAIN_TITLE_PATTERNS);
}

/** Domain name when the job title matches a target tech domain, or null. */
function getTitleDomain(title) {
  for (const entry of DOMAIN_PATTERNS) {
    if (textMatchesPatterns(title, entry.patterns)) return entry.name;
  }
  return null;
}

/**
 * Title-first classification (LinkedIn mode):
 *  1. Title matches a non-domain keyword → REJECT (description cannot save it).
 *  2. Title matches a target tech domain → KEEP.
 *  3. Otherwise → REJECT (a positive title match is required to pass).
 */
function classifyTitleStrict(item) {
  const { title } = extractJobText(item);
  if (!title) return { decision: 'reject', reason: 'no title' };
  if (titleMatchesNonDomain(title)) return { decision: 'reject', reason: 'non-domain title' };
  const domain = getTitleDomain(title);
  if (domain) return { decision: 'keep', domain };
  return { decision: 'reject', reason: 'no domain title match' };
}

/**
 * Filter raw job items to the target tech domains.
 * Returns { items, dropped, kept, domains, keptByDomain, droppedByReason }.
 * No-op (all items kept) for brands outside the domain-filter scope.
 *
 * @param {object[]} rawItems - raw job items from the scraper
 * @param {object}   brand    - Brand doc (controls whether filtering applies)
 * @param {object}   [opts]   - { titleStrict?: boolean } — title-first mode used
 *                              by LinkedIn; Upwork keeps the legacy title-OR-description mode.
 */
function filterJobsForDomain(rawItems, brand, opts = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  if (!shouldFilterByDomain(brand)) {
    return { items, dropped: 0, kept: items.length, domains: [], keptByDomain: {}, droppedByReason: {} };
  }

  const titleStrict = opts.titleStrict === true;
  const kept = [];
  const keptByDomain = {};
  const droppedByReason = {};
  let dropped = 0;

  for (const item of items) {
    const decision = titleStrict
      ? classifyTitleStrict(item)
      : (getMatchedDomain(item)
          ? { decision: 'keep', domain: getMatchedDomain(item) }
          : { decision: 'reject', reason: 'no domain match' });

    if (decision.decision === 'keep') {
      kept.push(item);
      keptByDomain[decision.domain] = (keptByDomain[decision.domain] || 0) + 1;
    } else {
      dropped++;
      if (decision.reason) {
        droppedByReason[decision.reason] = (droppedByReason[decision.reason] || 0) + 1;
      }
    }
  }

  return {
    items: kept,
    dropped,
    kept: kept.length,
    domains: DOMAIN_KEYWORDS.map((entry) => entry.name),
    keptByDomain,
    droppedByReason
  };
}

module.exports = {
  DOMAIN_KEYWORDS,
  DOMAIN_PATTERNS,
  NON_DOMAIN_TITLE_KEYWORDS,
  NON_DOMAIN_TITLE_PATTERNS,
  shouldFilterByDomain,
  filterJobsForDomain,
  jobMatchesAnyDomain,
  getMatchedDomain,
  titleMatchesNonDomain,
  getTitleDomain,
  classifyTitleStrict
};