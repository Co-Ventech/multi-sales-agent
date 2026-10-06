/**
 * profileScoringService.js — Batch AI profile recommendation engine.
 *
 * scoreProfilesForJob(job) evaluates every available CandidateProfile against a
 * job using a single DeepSeek batch call, applies the fixed weighting, picks the
 * top match, and updates the job document additively:
 *   aiRecommendedProfileId, aiRecommendedScore, selectedProfileId (default on
 *   first run), selectionSource, profileMatchScores, profileSelectionReasoning.
 *
 * An existing MANUAL_OVERRIDE selection is preserved across re-scoring runs.
 */

const CandidateProfile = require('../models/CandidateProfile');
const { evaluateProfilesForJob } = require('./deepseekService');

// Fixed scoring weights (sums to 100%).
const SCORE_WEIGHTS = {
  skills: 0.30,
  experience: 0.25,
  techStack: 0.20,
  seniority: 0.10,
  domain: 0.10,
  other: 0.05
};

// --- Candidate deduplication (duplicate profile safety) ---
// The same person can be ingested from more than one resume PDF, producing
// multiple CandidateProfile documents that share a normalized name. Without a
// dedup step they are scored twice, persist as duplicate profileMatchScores
// entries, and render as duplicate dropdown options. Dedup happens BEFORE any
// DeepSeek call or fallback scoring so the batch evaluates unique candidates.

/** Number of structured fields a profile carries (proxy for resume completeness). */
function profileCompleteness(c) {
  return (c && (
    (c.primarySkills || []).length +
    (c.secondarySkills || []).length +
    (c.technologies || []).length +
    (c.frameworks || []).length +
    (c.tools || []).length +
    (c.projectExperience || []).length +
    (c.employmentHistory || []).length
  )) || 0;
}

/** Stable identity key for a candidate: normalized name when present, else _id. */
function normalizeCandidateKey(c) {
  const name = String((c && (c.name || c.fullName)) || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return name ? `name:${name}` : `id:${String(c && c._id)}`;
}

/**
 * Deduplicate candidate profiles by their normalized name (falling back to _id)
 * so one person with multiple ingested resumes is never scored twice or listed
 * as duplicate dropdown options. Keeps the most complete profile (most
 * structured fields) as the representative, tie-broken by most recent update.
 * @param {Array<object>} candidates - CandidateProfile docs (lean ok)
 * @returns {Array<object>} unique candidates
 */
function dedupeCandidates(candidates = []) {
  const best = new Map();
  for (const c of candidates) {
    if (!c) continue;
    const key = normalizeCandidateKey(c);
    const prev = best.get(key);
    if (!prev) { best.set(key, c); continue; }
    const curScore = profileCompleteness(c);
    const prevScore = profileCompleteness(prev);
    const curTs = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
    const prevTs = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
    if (curScore > prevScore || (curScore === prevScore && curTs > prevTs)) best.set(key, c);
  }
  return [...best.values()];
}

/**
 * Defensive uniqueness for a persisted scores array: guarantee at most one entry
 * per (job, candidate) pair by profileId, keeping the first occurrence.
 * @param {Array<object>} entries - profileMatchScores-style entries
 * @returns {Array<object>} entries with unique profileIds
 */
function dedupeScoreEntries(entries = []) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (!e) continue;
    const key = e.profileId != null ? String(e.profileId) : `__anon_${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Normalize either job schema (UpworkJob / LinkedinJob) into prompt text. */
function getJobText(job) {
  return {
    title: job.title || '',
    description: String(job.descriptionText || job.description || '').slice(0, 6000)
  };
}

/**
 * Lightweight heuristic to infer a job's core role category from its title.
 * When the full job is also provided, the title signal is augmented with the
 * Multi-Pillar Task Weighting (see computeTaskPillars): if infrastructure/
 * database-deployment + QA/testing deliverables form >= 50% of the deliverable
 * scope, the category resolves to 'Backend/DevOps' or 'QA/Testing' instead of a
 * generic frontend bucket. The DeepSeek evaluator uses this as the anchor for
 * its mandatory role alignment check; the final judgment still considers the
 * full description.
 * @param {string} title - job title
 * @param {object|string} [jobOrDescription] - full job object or description text
 * @returns {string} Fullstack Web | AI/ML | Frontend Web | Backend | Mobile |
 *   DevOps | Data | Backend/DevOps | QA/Testing | General
 */
function inferCoreRoleCategory(title = '', jobOrDescription) {
  const t = String(title || '').toLowerCase();
  if (/full\s?stack/.test(t)) return 'Fullstack Web';
  if (/\bai\b|machine learning|\bml\b|artificial intelligence|\bllm\b|data science/.test(t)) return 'AI/ML';
  if (/front\s?end/.test(t)) return 'Frontend Web';
  if (/back\s?end/.test(t)) return 'Backend';
  if (/mobile|ios|android|react native|flutter/.test(t)) return 'Mobile';
  if (/devops|sre|infrastructure|kubernetes|cloud engineer|\baws\b|\bgcp\b|\bazure\b/.test(t)) return 'DevOps';
  if (/data engineer|data analyst|big data|\betl\b/.test(t)) return 'Data';

  // Multi-pillar task weighting: when infrastructure/database deployment plus
  // QA/testing deliverables dominate the job scope, decide whether Backend/
  // DevOps or QA/Testing is the primary deliverable rather than collapsing the
  // job into a generic frontend role.
  if (jobOrDescription) {
    const pillars = computeTaskPillars(jobOrDescription);
    const nonFeatureScope = pillars.infrastructure + pillars.qaTesting;
    if (nonFeatureScope > 0 && nonFeatureScope >= pillars.featureEngineering) {
      return pillars.infrastructure >= pillars.qaTesting ? 'Backend/DevOps' : 'QA/Testing';
    }
  }
  return 'General';
}

// --- Multi-Pillar Task Weighting (deliverable-aware role extraction) ---
// Jobs are decomposed into three generic deliverable pillars so a posting that
// is primarily infrastructure/database deployment or QA/testing is NOT collapsed
// into a generic frontend bucket. Signal lists are intentionally brand-agnostic
// (deploy, schema, auth, api, test, hardware, ui, layout) — no proprietary tool
// or product names are hardcoded.

const TASK_PILLAR_SIGNALS = {
  infrastructure: {
    db: [
      'database', 'databases', 'db', 'schema', 'schemas', 'auth', 'authentication',
      'authorization', 'api', 'apis', 'rest api', 'backend', 'back-end', 'server-side',
      'server side', 'migration', 'migrations', 'data model', 'data modeling', 'crud',
      'query', 'queries', 'endpoint', 'endpoints', 'middleware', 'data sync'
    ],
    deploy: [
      'deploy', 'deployment', 'deployments', 'cloud', 'serverless', 'pipeline', 'pipelines',
      'ci/cd', 'provisioning', 'provision', 'infrastructure', 'setup', 'networking',
      'monitoring', 'uptime', 'reliability', 'scaling', 'container', 'containers'
    ]
  },
  qaTesting: [
    'test', 'tests', 'testing', 'qa', 'quality assurance', 'quality', 'test case', 'test cases',
    'test plan', 'test suite', 'regression', 'unit test', 'unit testing', 'integration test',
    'integration testing', 'e2e', 'end-to-end', 'end to end', 'automation', 'bug tracking',
    'verification', 'verify', 'validation', 'validate', 'hardware testing', 'hardware test',
    'real device', 'real-device', 'device testing', 'device test', 'test on device', 'test on hardware'
  ],
  featureEngineering: [
    'frontend', 'front-end', 'ui', 'user interface', 'ux', 'user experience', 'interface',
    'interfaces', 'layout', 'layouts', 'component', 'components', 'web app', 'web application',
    'webpage', 'web page', 'landing page', 'dashboard', 'screen', 'screens', 'render',
    'rendering', 'responsive', 'widget', 'widgets', 'client-side', 'client side', 'spa',
    'design system', 'styling', 'css', 'html'
  ]
};

/**
 * Decompose a job into generic deliverable pillars (infrastructure/database
 * deployment, QA/testing, feature engineering). Title signals carry double
 * weight over description signals, mirroring the title-first convention used
 * elsewhere in this module.
 * @param {object|string} input - job object (title/descriptionText/description) or raw text
 * @returns {{infrastructure: number, infrastructureDb: number, infrastructureDeploy: number, qaTesting: number, featureEngineering: number}}
 */
function computeTaskPillars(input) {
  const title = (input && typeof input === 'object') ? String(input.title || '') : '';
  const description = (input && typeof input === 'object')
    ? String(input.descriptionText || input.description || '')
    : String(input || '');

  const countHits = (text, signalList) => signalList.reduce((n, sig) => n + (keywordMatches(text, sig) ? 1 : 0), 0);

  let infraDb = countHits(title, TASK_PILLAR_SIGNALS.infrastructure.db) * 2;
  let infraDeploy = countHits(title, TASK_PILLAR_SIGNALS.infrastructure.deploy) * 2;
  let qa = countHits(title, TASK_PILLAR_SIGNALS.qaTesting) * 2;
  let feature = countHits(title, TASK_PILLAR_SIGNALS.featureEngineering) * 2;

  infraDb += countHits(description, TASK_PILLAR_SIGNALS.infrastructure.db);
  infraDeploy += countHits(description, TASK_PILLAR_SIGNALS.infrastructure.deploy);
  qa += countHits(description, TASK_PILLAR_SIGNALS.qaTesting);
  feature += countHits(description, TASK_PILLAR_SIGNALS.featureEngineering);

  return {
    infrastructure: infraDb + infraDeploy,
    infrastructureDb: infraDb,
    infrastructureDeploy: infraDeploy,
    qaTesting: qa,
    featureEngineering: feature
  };
}

// --- Deterministic domain scoring (hard rules, independent of the LLM) ---
// The LLM can be gamed by keyword overlap ("buzzword trap"). These rules run
// AFTER buildScoreEntry and HARD-CAP a candidate's final score whenever the
// candidate's primary domain clearly does not match the job's core role.

const DOMAIN_ROLE_ORDER = ['FULLSTACK', 'BACKEND', 'FRONTEND', 'AI_ML', 'MOBILE', 'DEVOPS'];

function countRoleMatches(text) {
  const t = String(text || '').toLowerCase();
  return {
    FULLSTACK: /full\s?stack/.test(t) ? 1 : 0,
    BACKEND: (t.match(/back\s?end|backend|node\.?\s?js|nodejs|\bexpress\b|\bdjango\b|\blaravel\b|\bspring\b|\bflask\b|\bfastapi\b|\bpostgres(ql)?\b|\bsql\b|microservices|rest\s?api/g) || []).length,
    FRONTEND: (t.match(/front\s?end|frontend|react\b|next\.?\s?js|\bvue\b|\bangular\b|\bsvelte\b|tailwind|typescript|webflow/g) || []).length,
    AI_ML: (t.match(/\bai\b|machine learning|\bml\b|artificial intelligence|\bllm\b|deep learning|\bnlp\b|langchain|pytorch|tensorflow|data science|computer vision|neural network|\bgpt\b|generative ai|\brag\b/g) || []).length,
    MOBILE: (t.match(/react native|\bflutter\b|\bios\b|\bandroid\b|\bswift\b|\bkotlin\b|\bmobile\b/g) || []).length,
    DEVOPS: (t.match(/devops|\bsre\b|kubernetes|\bk8s\b|\bdocker\b|\bterraform\b|\baws\b|\bgcp\b|\bazure\b|ci\/cd/g) || []).length
  };
}

/** Pick the highest-count role; tie-break by DOMAIN_ROLE_ORDER priority. */
function pickTopRole(counts) {
  let top = null;
  let best = 0;
  for (const role of DOMAIN_ROLE_ORDER) {
    if (counts[role] > best) { top = role; best = counts[role]; }
  }
  return best > 0 ? top : null;
}

/**
 * Deterministically extract the job's PRIMARY ROLE from its title/description.
 * The title is the #1 signal (a "Fullstack" title wins over any AI buzzwords in
 * the description, which is exactly the buzzword-trap guard this fixes). Falls
 * back to role-keyword counting over title + description, with an anti-buzzword
 * guard: a description that merely "mentions AI" must not reclassify a web job
 * as AI/ML — AI/ML is chosen only when its dedicated signals outnumber the
 * combined web-stack signals.
 *
 * MULTI-PILLAR TASK WEIGHTING (deliverable-aware): when the description's
 * infrastructure/database-deployment + QA/testing deliverables carry >= 50% of
 * the total deliverable signal weight, the role is NOT collapsed into a generic
 * frontend bucket. It resolves to BACKEND (database/auth/backend-leaning),
 * DEVOPS (deployment/cloud-leaning), or QA (testing-leaning) instead.
 * @returns {string|null} FULLSTACK | BACKEND | FRONTEND | AI_ML | MOBILE | DEVOPS | QA
 */
function extractJobPrimaryRole(job) {
  const title = String(job.title || '');
  if (/full\s?stack/.test(title.toLowerCase())) return 'FULLSTACK';
  const titleRole = pickTopRole(countRoleMatches(title));
  if (titleRole) return titleRole;

  const desc = String(job.descriptionText || job.description || '');
  const counts = countRoleMatches(`${title} ${desc}`);
  const webCount = counts.FULLSTACK + counts.BACKEND + counts.FRONTEND;
  if (counts.AI_ML > webCount) return 'AI_ML';

  // Multi-pillar task weighting: never collapse an infrastructure/database
  // deployment or QA/testing job into a generic frontend bucket.
  const pillars = computeTaskPillars(job);
  const nonFeatureScope = pillars.infrastructure + pillars.qaTesting;
  if (nonFeatureScope > 0 && nonFeatureScope >= pillars.featureEngineering) {
    if (pillars.qaTesting > pillars.infrastructure) return 'QA';
    return pillars.infrastructureDeploy > pillars.infrastructureDb ? 'DEVOPS' : 'BACKEND';
  }

  const webRole = pickTopRole({ ...counts, AI_ML: 0, MOBILE: 0, DEVOPS: 0 });
  if (webRole) return webRole;
  if (counts.MOBILE > 0) return 'MOBILE';
  if (counts.DEVOPS > 0) return 'DEVOPS';
  return null;
}

/**
 * Deterministically extract a candidate's PRIMARY DOMAIN from their
 * professional title first, then skills/tech/frameworks/project titles.
 * @returns {string|null} FULLSTACK | BACKEND | FRONTEND | AI_ML | MOBILE | DEVOPS
 */
function extractCandidatePrimaryDomain(profile) {
  const titleRole = pickTopRole(countRoleMatches(String(profile.professionalTitle || '')));
  if (titleRole) return titleRole;

  const parts = [
    ...(profile.primarySkills || []),
    ...(profile.secondarySkills || []),
    ...(profile.technologies || []),
    ...(profile.frameworks || []),
    ...(profile.tools || []),
    ...(profile.projectExperience || []).map((p) => p.title)
  ].filter(Boolean);
  return pickTopRole(countRoleMatches(parts.join(' ')));
}

/** Flatten a candidate profile into a single searchable text blob. */
function profileToText(profile) {
  return [
    profile.professionalTitle,
    ...(profile.primarySkills || []),
    ...(profile.secondarySkills || []),
    ...(profile.technologies || []),
    ...(profile.frameworks || []),
    ...(profile.tools || []),
    ...(profile.projectExperience || []).map((p) => `${p.title || ''} ${p.description || ''}`),
    ...(profile.employmentHistory || []).map((e) => `${e.title || ''} ${e.description || ''}`)
  ].filter(Boolean).join(' ');
}

/** Does the candidate explicitly list core web stack (React/Next/Node/Express/Vue/Django/Laravel/SQL)? */
const CORE_WEB_STACK_RE = /react|next\.?\s?js|node\.?\s?js|nodejs|express|vue|angular|svelte|tailwind|django|laravel|spring|flask|fastapi|nest|graphql|\bsql\b|postgres|mysql|mongodb|redis|typescript|javascript|\bhtml\b|\bcss\b|web development/i;

function hasCoreWebStack(profile) {
  return CORE_WEB_STACK_RE.test(profileToText(profile));
}

/** Does the candidate explicitly list AI/ML stack (Python/PyTorch/TensorFlow/LLM frameworks)? */
const AI_ML_STACK_RE = /python|pytorch|tensorflow|keras|langchain|\bllm\b|openai|machine learning|deep learning|\bnlp\b|computer vision|neural network|data science|model training|\bgpt\b|generative ai|\brag\b/i;

function hasAIMLStack(profile) {
  return AI_ML_STACK_RE.test(profileToText(profile));
}

const SYSTEM_DOMAIN_OVERRULE_WEB = 'Score capped at 55% due to domain mismatch: candidate specializes in AI/ML while this is a Fullstack Web role.';
const SYSTEM_DOMAIN_OVERRULE_AI = 'Score capped at 50% due to domain mismatch: candidate specializes in Frontend while this is an AI/ML role.';

/**
 * Apply deterministic HARD-CAP domain penalties on top of the LLM score:
 *  - Web job (FULLSTACK/BACKEND/FRONTEND) + AI/ML candidate with NO core web
 *    stack  => cap final score at 55%.
 *  - AI/ML job + FRONTEND candidate with NO AI/ML stack => cap final score at 50%.
 * Appends a natural-language domain-mismatch note to the entry's reasoning.
 * @param {object} entry - score entry from buildScoreEntry
 * @param {object} ctx - { jobPrimaryRole, candidatePrimaryDomain, hasCoreWebStack, hasAIMLStack }
 * @returns {object} the (possibly modified) entry
 */
function applyDeterministicDomainPenalty(entry, ctx) {
  const { jobPrimaryRole, candidatePrimaryDomain, hasCoreWebStack, hasAIMLStack } = ctx;
  const overrules = [];

  const jobIsWeb = jobPrimaryRole === 'FULLSTACK' || jobPrimaryRole === 'BACKEND' || jobPrimaryRole === 'FRONTEND';
  if (jobIsWeb && candidatePrimaryDomain === 'AI_ML' && !hasCoreWebStack) {
    entry.score = Math.min(entry.score, 55);
    overrules.push(SYSTEM_DOMAIN_OVERRULE_WEB);
  }
  if (jobPrimaryRole === 'AI_ML' && candidatePrimaryDomain === 'FRONTEND' && !hasAIMLStack) {
    entry.score = Math.min(entry.score, 50);
    overrules.push(SYSTEM_DOMAIN_OVERRULE_AI);
  }

  if (overrules.length) {
    entry.score = Number(Math.max(0, Math.min(100, entry.score)).toFixed(3));
    entry.reasoning = entry.reasoning ? `${entry.reasoning}\n${overrules.join('\n')}` : overrules.join('\n');
    console.log('[PROFILE SCORING] System domain overrule applied:', entry.profileName, '=> score', entry.score + '%', '-', overrules.join(' | '));
  }
  return entry;
}

// --- Dynamic multi-domain taxonomy (drives the deterministic fallback) ---
// Broad, mutually-exclusive domain categories detected from candidate/job
// titles and skill vocabulary. The matrix resolves every category pair through
// compatibility tiers, so it scales to ALL present and future candidate domains
// without hardcoded per-role if-statements.

const DOMAIN_CATEGORIES = {
  SOFTWARE_DEV: {
    label: 'Software Development',
    keywords: [
      'fullstack', 'full stack', 'frontend', 'front-end', 'backend', 'back-end',
      'software engineer', 'software developer', 'web developer', 'web engineer',
      'application developer', 'mobile developer', 'ios developer', 'android developer',
      'react', 'react native', 'flutter', 'node.js', 'nodejs', 'typescript',
      'javascript', 'angular', 'vue', 'express', 'django', 'spring', 'java developer',
      'python developer', 'php developer', 'dotnet', '.net'
    ]
  },
  QUALITY_ASSURANCE: {
    label: 'Quality Assurance',
    keywords: [
      'qa', 'quality assurance', 'quality engineer', 'test engineer', 'qa automation',
      'automation tester', 'software tester', 'test automation', 'manual testing',
      'test lead', 'selenium', 'cypress', 'playwright', 'testng', 'jest'
    ]
  },
  DESIGN: {
    label: 'Design',
    keywords: [
      'ui/ux', 'ui designer', 'ux designer', 'product designer', 'visual designer',
      'graphic designer', 'web designer', 'figma', 'sketch', 'adobe xd', 'photoshop',
      'illustrator', 'interaction design', 'user experience', 'user interface'
    ]
  },
  DEVOPS_INFRA: {
    label: 'DevOps & Infrastructure',
    keywords: [
      'devops', 'sre', 'site reliability', 'cloud engineer', 'infrastructure',
      'system administrator', 'sysadmin', 'platform engineer', 'kubernetes', 'k8s',
      'docker', 'terraform', 'ansible', 'aws', 'azure', 'gcp', 'ci/cd', 'linux'
    ]
  },
  DATA_AI: {
    label: 'Data & AI',
    keywords: [
      'data science', 'data scientist', 'data analyst', 'data engineer', 'machine learning',
      'ml engineer', 'ai engineer', 'artificial intelligence', 'llm', 'nlp', 'deep learning',
      'pandas', 'numpy', 'pytorch', 'tensorflow', 'big data', 'etl', 'tableau', 'power bi',
      'analytics', 'data analytics'
    ]
  },
  MARKETING_CONTENT: {
    label: 'Marketing & Content',
    keywords: [
      'marketing', 'content', 'copywriter', 'seo', 'social media', 'digital marketing',
      'content writer', 'email marketing', 'growth marketing', 'seo specialist', 'ppc',
      'brand', 'communications', 'blog'
    ]
  }
};

const DOMAIN_CATEGORY_ORDER = Object.keys(DOMAIN_CATEGORIES);

/** Word-boundary keyword matcher (avoids substring false positives like "qa" inside "equal"). */
function keywordMatches(text, keyword) {
  const t = String(text || '').toLowerCase();
  if (/\s|[./#]/.test(keyword)) return t.includes(keyword.toLowerCase());
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t);
}

/** Count category-keyword hits in a text blob; title-like sources weigh more. */
function countCategoryHits(text, weight = 1) {
  const counts = {};
  for (const key of DOMAIN_CATEGORY_ORDER) {
    let hits = 0;
    for (const kw of DOMAIN_CATEGORIES[key].keywords) {
      if (keywordMatches(text, kw)) hits += 1;
    }
    counts[key] = hits * weight;
  }
  return counts;
}

/**
 * Classify a candidate or job into one of the broad domain categories.
 * The title line carries the most weight, then employment-history titles, then
 * the skill/tech/tool vocabulary. Returns null when no category has evidence.
 * @param {string} title - professional title (candidate) or job title
 * @param {object|null} [profile] - CandidateProfile fields (skills, history, etc.)
 * @returns {string|null} SOFTWARE_DEV | QUALITY_ASSURANCE | DESIGN | DEVOPS_INFRA | DATA_AI | MARKETING_CONTENT
 */
function classifyDomainCategory(title, profile) {
  const totals = {};
  for (const key of DOMAIN_CATEGORY_ORDER) totals[key] = 0;

  const titleCounts = countCategoryHits(title, 3);
  for (const key of DOMAIN_CATEGORY_ORDER) totals[key] += titleCounts[key];

  if (profile && typeof profile === 'object') {
    for (const e of profile.employmentHistory || []) {
      const c = countCategoryHits(e.title || '', 2);
      for (const key of DOMAIN_CATEGORY_ORDER) totals[key] += c[key];
    }
    const vocabulary = [
      ...(profile.primarySkills || []),
      ...(profile.secondarySkills || []),
      ...(profile.technologies || []),
      ...(profile.frameworks || []),
      ...(profile.tools || []),
      ...(profile.projectExperience || []).map((p) => `${p.title || ''} ${p.description || ''}`)
    ].filter(Boolean).join(' ');
    const vocabCounts = countCategoryHits(vocabulary, 1);
    for (const key of DOMAIN_CATEGORY_ORDER) totals[key] += vocabCounts[key];
  }

  let best = null;
  let bestScore = 0;
  for (const key of DOMAIN_CATEGORY_ORDER) {
    if (totals[key] > bestScore) { best = key; bestScore = totals[key]; }
  }
  return bestScore > 0 ? best : null;
}

/** Map the legacy job-role token (from extractJobPrimaryRole) onto a domain category. */
const JOB_ROLE_TO_CATEGORY = {
  FULLSTACK: 'SOFTWARE_DEV',
  BACKEND: 'SOFTWARE_DEV',
  FRONTEND: 'SOFTWARE_DEV',
  MOBILE: 'SOFTWARE_DEV',
  AI_ML: 'DATA_AI',
  DEVOPS: 'DEVOPS_INFRA',
  QA: 'QUALITY_ASSURANCE'
};

function mapJobRoleToCategory(role) {
  return JOB_ROLE_TO_CATEGORY[role] || null;
}

// Domain compatibility tiers, resolved dynamically per category pair:
//  - exact category match:    base affinity 0.85 - 1.00
//  - adjacent/support match:  base affinity 0.40 - 0.60
//  - distant cross-domain:    base affinity 0.10 - 0.25
const DOMAIN_SELF_AFFINITY = {
  SOFTWARE_DEV: 0.95,
  QUALITY_ASSURANCE: 0.92,
  DESIGN: 0.93,
  DEVOPS_INFRA: 0.90,
  DATA_AI: 0.94,
  MARKETING_CONTENT: 0.92
};

const DOMAIN_ADJACENT_PAIRS = {
  SOFTWARE_DEV: ['DEVOPS_INFRA', 'DATA_AI'],
  DEVOPS_INFRA: ['SOFTWARE_DEV', 'DATA_AI'],
  DATA_AI: ['SOFTWARE_DEV', 'DEVOPS_INFRA'],
  QUALITY_ASSURANCE: ['SOFTWARE_DEV'],
  DESIGN: ['MARKETING_CONTENT'],
  MARKETING_CONTENT: ['DESIGN']
};

const AFFINITY_BANDS = {
  exact: { base: 0.92, min: 0.85, max: 1.00 },
  adjacent: { base: 0.50, min: 0.40, max: 0.60 },
  distant: { base: 0.18, min: 0.10, max: 0.25 }
};

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Resolve the affinity between a job's domain category and a candidate's
 * category using the compatibility matrix. The value is tuned dynamically
 * within its tier band by the candidate's skill overlap (stronger evidence
 * nudges affinity upward). Unknown categories resolve to a neutral 0.5.
 * @returns {number} 0-1 domain affinity
 */
function getDomainAffinity(jobCategory, candidateCategory, skillOverlap = 0) {
  const overlap = clamp(Number(skillOverlap) || 0, 0, 1);
  if (!jobCategory || !candidateCategory) return 0.5;

  let tier;
  if (jobCategory === candidateCategory) tier = 'exact';
  else if ((DOMAIN_ADJACENT_PAIRS[jobCategory] || []).includes(candidateCategory)) tier = 'adjacent';
  else tier = 'distant';

  const band = AFFINITY_BANDS[tier];
  const base = tier === 'exact' ? (DOMAIN_SELF_AFFINITY[jobCategory] || band.base) : band.base;
  return clamp(base + (overlap - 0.5) * 0.2, band.min, band.max);
}

/** Stack tokens explicitly listed on the job (skills/tags) plus stack keywords harvested from the posting. */
const JOB_STACK_TOKEN_RE = /\b(frontend|front-end|backend|back-end|fullstack|full-stack|react|vue|angular|next\.?js|node\.?js|nodejs|express|django|laravel|flask|fastapi|spring|typescript|javascript|python|java|golang|php|\.net|\bsql\b|postgres|postgresql|mysql|mongodb|redis|graphql|docker|kubernetes|k8s|terraform|aws|azure|gcp|ci\/cd|devops|machine learning|\bml\b|\bai\b|llm|selenium|cypress|figma|wordpress|shopify|seo|content|copywriting|analytics|tableau|power bi|etl|pandas|pytorch|tensorflow|database|authentication|authorization|api|integration|cloud|pipeline|deployment|automation|testing|ui)\b/gi;

function extractJobSkillTokens(job) {
  const tokens = new Set();
  const explicit = [
    ...(Array.isArray(job.skills) ? job.skills : []),
    ...(Array.isArray(job.tags) ? job.tags : [])
  ].map((s) => String(s || '').toLowerCase().trim()).filter(Boolean);
  for (const s of explicit) tokens.add(s);

  const text = `${job.title || ''} ${String(job.descriptionText || job.description || '').slice(0, 3000)}`.toLowerCase();
  const seen = new Set();
  for (const m of (text.match(JOB_STACK_TOKEN_RE) || [])) {
    const norm = m.toLowerCase();
    if (!seen.has(norm)) { seen.add(norm); tokens.add(norm); }
  }
  return [...tokens];
}

function extractCandidateSkillTokens(profile) {
  return [
    ...(profile.primarySkills || []),
    ...(profile.secondarySkills || []),
    ...(profile.technologies || []),
    ...(profile.frameworks || []),
    ...(profile.tools || []),
    ...(profile.cloudPlatforms || [])
  ].map((s) => String(s || '').toLowerCase().trim()).filter(Boolean);
}

/**
 * Fraction of the job's required stack the candidate explicitly covers (0-1).
 * @returns {number} 0-1 skill overlap
 */
function computeSkillOverlap(profile, job) {
  const jobTokens = extractJobSkillTokens(job || {});
  const candidateTokens = extractCandidateSkillTokens(profile);
  if (!jobTokens.length || !candidateTokens.length) return 0;

  let matched = 0;
  for (const c of candidateTokens) {
    if (jobTokens.some((j) => j === c || j.includes(c) || c.includes(j))) matched += 1;
  }
  return clamp(matched / jobTokens.length, 0, 1);
}

// --- Semantic functional-domain categorizer (drives the bounded ceilings) ---
// Jobs are parsed into generic ABSTRACT functional requirements rather than
// matched against brand-name tools, so the categorizer generalizes across every
// present and future stack without hardcoding proprietary products (e.g., a
// "Base44 + Supabase" backend integration job resolves to DATA_FLOW_INTEGRATION
// through generic signals like database/auth/api/backend/workflow).

const FUNCTIONAL_DOMAIN_ORDER = [
  'DATA_FLOW_INTEGRATION',
  'INTERFACE_CREATION',
  'QUALITY_VERIFICATION',
  'INFRASTRUCTURE_DEPLOYMENT',
  'CONTENT_GROWTH'
];

const FUNCTIONAL_DOMAIN_SIGNALS = {
  DATA_FLOW_INTEGRATION: [
    'database', 'databases', 'auth', 'authentication', 'authorization', 'api', 'apis',
    'rest api', 'graphql', 'webhook', 'backend', 'server-side', 'server side',
    'workflow', 'workflows', 'integration', 'integrations', 'connection', 'connections',
    'connector', 'data sync', 'sync', 'migration', 'schema', 'query', 'queries',
    'endpoint', 'endpoints', 'data model', 'data modeling', 'crud', 'cloud function',
    'middleware', 'data flow', 'etl'
  ],
  INTERFACE_CREATION: [
    'frontend', 'front-end', 'ui', 'ux', 'user interface', 'user experience',
    'web layout', 'layouts', 'layout', 'component', 'components', 'interface',
    'interfaces', 'responsive', 'widget', 'widgets', 'screen', 'screens',
    'dashboard', 'design system', 'web page', 'landing page'
  ],
  QUALITY_VERIFICATION: [
    'testing', 'test', 'tests', 'qa', 'quality assurance', 'quality', 'automation',
    'automated test', 'automated testing', 'bug tracking', 'test case', 'test cases',
    'test plan', 'test suite', 'regression', 'unit test', 'unit testing',
    'integration test', 'integration testing', 'e2e', 'end-to-end', 'end to end',
    'test runner', 'assertion', 'coverage'
  ],
  INFRASTRUCTURE_DEPLOYMENT: [
    'devops', 'cloud', 'pipeline', 'pipelines', 'deployment', 'deploy', 'deploys',
    'ci/cd', 'continuous integration', 'continuous deployment', 'kubernetes',
    'container', 'containers', 'docker', 'terraform', 'infrastructure', 'provisioning',
    'serverless', 'monitoring', 'scaling', 'load balancer', 'vpc', 'networking',
    'uptime', 'reliability', 'observability'
  ],
  CONTENT_GROWTH: [
    'marketing', 'copywriting', 'copy', 'seo', 'content', 'content marketing',
    'social media', 'email campaign', 'email marketing', 'growth', 'brand',
    'branding', 'blog', 'blogging', 'ad copy', 'campaign', 'campaigns', 'newsletter',
    'lead generation', 'cta', 'landing page copy'
  ]
};

/**
 * Parse a job description into its dominant ABSTRACT functional domain. Returns
 * the functional domain with the most semantic signal hits.
 * @param {string} jobDescription - job title + full description text
 * @returns {string|null} DATA_FLOW_INTEGRATION | INTERFACE_CREATION | QUALITY_VERIFICATION | INFRASTRUCTURE_DEPLOYMENT | CONTENT_GROWTH
 */
function extractJobFunctionalDomain(jobDescription) {
  const text = String(jobDescription || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const key of FUNCTIONAL_DOMAIN_ORDER) {
    let hits = 0;
    for (const sig of FUNCTIONAL_DOMAIN_SIGNALS[key]) {
      if (keywordMatches(text, sig)) hits += 1;
    }
    if (hits > bestScore) { best = key; bestScore = hits; }
  }
  return best;
}

// --- Human-readable domain labels for fallback reasoning ---
// The categorizers above return internal enum keys (needed by the deterministic
// ceiling math below); these maps render those keys as clean, UI-ready labels.
// Unclassified jobs/profiles resolve to a generic label instead of a raw enum
// or 'UNKNOWN', so fallback explanations read naturally in the UI.

const GENERAL_TECHNICAL_SERVICES_LABEL = 'General Technical Services';

const FUNCTIONAL_DOMAIN_LABELS = {
  DATA_FLOW_INTEGRATION: 'Data & System Integration',
  INTERFACE_CREATION: 'Interface & Frontend Development',
  QUALITY_VERIFICATION: 'Quality Assurance & Testing',
  INFRASTRUCTURE_DEPLOYMENT: 'Infrastructure & Deployment',
  CONTENT_GROWTH: 'Marketing & Content'
};

const DOMAIN_CATEGORY_LABELS = {
  SOFTWARE_DEV: 'Software Development',
  QUALITY_ASSURANCE: 'Quality Assurance',
  DESIGN: 'Design',
  DEVOPS_INFRA: 'DevOps & Infrastructure',
  DATA_AI: 'Data & AI',
  MARKETING_CONTENT: 'Marketing & Content'
};

function getFunctionalDomainLabel(key) {
  return FUNCTIONAL_DOMAIN_LABELS[key] || GENERAL_TECHNICAL_SERVICES_LABEL;
}

function getDomainCategoryLabel(key) {
  return DOMAIN_CATEGORY_LABELS[key] || GENERAL_TECHNICAL_SERVICES_LABEL;
}

/** Extract a short, readable list of the candidate's key skills for reasoning text. */
function extractCandidateKeySkills(profile) {
  const sources = [
    ...(profile && Array.isArray(profile.primarySkills) ? profile.primarySkills : []),
    ...(profile && Array.isArray(profile.secondarySkills) ? profile.secondarySkills : []),
    ...(profile && Array.isArray(profile.technologies) ? profile.technologies : []),
    ...(profile && Array.isArray(profile.frameworks) ? profile.frameworks : []),
    ...(profile && Array.isArray(profile.tools) ? profile.tools : [])
  ].map((s) => String(s || '').trim()).filter(Boolean);
  return [...new Set(sources)].slice(0, 4).join(', ');
}

/**
 * Build a candidate-specific, human-readable fallback explanation used ONLY
 * when the live LLM is offline or omitted the candidate. Every sentence is
 * derived from the candidate's actual profile attributes (name, title, skills,
 * domain) and the job title — no fill-in-the-blank domain-match boilerplate.
 * @param {object} profile - CandidateProfile fields
 * @param {object} job - job document (title/description)
 * @param {string|null} candidateCategory - candidate-domain enum key
 * @param {number} domainBaseline - domain alignment multiplier (0-1)
 * @param {boolean} hardCeilingApplied - whether the cross-domain cap was applied
 * @param {number} score - final score (0-100, may be a float)
 * @returns {string} human-readable reason
 */
function buildFallbackReasoning(profile, job, candidateCategory, domainBaseline, hardCeilingApplied, score) {
  const candidateName = (profile && profile.name) || 'Candidate';
  const candidateTitle = (profile && profile.professionalTitle) || getDomainCategoryLabel(candidateCategory) || 'Professional';
  const candidateDomainTitle = getDomainCategoryLabel(candidateCategory);
  const candidateSkills = extractCandidateKeySkills(profile) || candidateDomainTitle.toLowerCase();
  const jobTitle = (job && job.title) || 'this position';
  const roundedScore = Math.round(Number(score) || 0);

  if (hardCeilingApplied) {
    return `${candidateName} is specialized in ${candidateDomainTitle}, which has limited overlap with core ${jobTitle} deliverables, resulting in a ${roundedScore}% match.`;
  }
  if (domainBaseline >= 0.7) {
    return `${candidateName} (${candidateTitle}) brings core experience in ${candidateSkills}, directly matching the requirements for ${jobTitle}.`;
  }
  return `${candidateName} (${candidateTitle}) has experience in ${candidateSkills}, which partially aligns with the requirements for ${jobTitle}, resulting in a ${roundedScore}% match.`;
}

// Bounded domain ceilings for the fallback path.
//  - Software engineers on engineering jobs receive a base domain alignment
//    baseline of 0.70 (core engineering transferability), even at 0% overlap.
//  - Non-engineering candidates (QA / Marketing / Design / DevOps / Data-AI) on
//    engineering jobs are capped at 0.20 — mathematically impossible for them to
//    win over a DeepSeek-scored matching candidate.
const ENGINEERING_FUNCTIONAL_DOMAINS = ['DATA_FLOW_INTEGRATION', 'INTERFACE_CREATION', 'INFRASTRUCTURE_DEPLOYMENT'];
const NON_ENGINEERING_CANDIDATE_DOMAINS = ['QUALITY_ASSURANCE', 'MARKETING_CONTENT', 'DESIGN', 'DEVOPS_INFRA', 'DATA_AI'];

// M_domain (Domain Alignment Multiplier) drives the 0.7-weighted domain
// component: M_domain * 0.7 = the "base domain baseline score".
//   - Software engineers on engineering jobs: M_domain = 1.0  => 1.0 * 0.7 = 0.70
//     (the mandated 70% baseline, attributed even at 0% skill overlap).
//   - Non-engineering candidates on engineering jobs: hard ceiling 0.20.
const SOFTWARE_DEV_DOMAIN_ALIGNMENT = 1.0;
const HARD_DOMAIN_CEILING_NON_ENGINEERING = 0.20;
const ADJACENT_ENGINEERING_ALIGNMENT = 0.15;
const NEUTRAL_DOMAIN_ALIGNMENT = 0.50;

/**
 * Domain Alignment Multiplier (M_domain): how aligned the candidate's primary
 * domain is with the job's abstract functional domain (0-1).
 * @returns {number} 0-1 domain alignment multiplier
 */
function computeDomainAlignmentMultiplier(jobFunctionalDomain, candidateCategory) {
  if (!jobFunctionalDomain || !candidateCategory) return NEUTRAL_DOMAIN_ALIGNMENT;

  if (ENGINEERING_FUNCTIONAL_DOMAINS.includes(jobFunctionalDomain)) {
    if (candidateCategory === 'SOFTWARE_DEV') return SOFTWARE_DEV_DOMAIN_ALIGNMENT;
    if (jobFunctionalDomain === 'INFRASTRUCTURE_DEPLOYMENT' && candidateCategory === 'DEVOPS_INFRA') return SOFTWARE_DEV_DOMAIN_ALIGNMENT;
    if (NON_ENGINEERING_CANDIDATE_DOMAINS.includes(candidateCategory)) return HARD_DOMAIN_CEILING_NON_ENGINEERING;
    if (candidateCategory === 'DEVOPS_INFRA' || candidateCategory === 'DATA_AI') return ADJACENT_ENGINEERING_ALIGNMENT;
    return NEUTRAL_DOMAIN_ALIGNMENT;
  }

  // Non-engineering functional jobs: exact candidate-domain match earns the same full alignment.
  const exactMap = {
    QUALITY_VERIFICATION: 'QUALITY_ASSURANCE',
    CONTENT_GROWTH: 'MARKETING_CONTENT'
  };
  if (exactMap[jobFunctionalDomain] === candidateCategory) return SOFTWARE_DEV_DOMAIN_ALIGNMENT;
  return NEUTRAL_DOMAIN_ALIGNMENT;
}

/**
 * Hard ceiling for the fallback path (1.0 = no cap). Non-engineering candidates
 * on engineering jobs are hard-capped at 0.20.
 * @returns {number} 0-1 ceiling
 */
function computeHardDomainCeiling(jobFunctionalDomain, candidateCategory) {
  if (ENGINEERING_FUNCTIONAL_DOMAINS.includes(jobFunctionalDomain) && NON_ENGINEERING_CANDIDATE_DOMAINS.includes(candidateCategory)) {
    return HARD_DOMAIN_CEILING_NON_ENGINEERING;
  }
  return 1.0;
}

/** Apply the fixed weighting to per-criterion scores (0-100). */
function computeWeightedScore(criteria = {}) {
  const c = {
    skills: Number(criteria.skills) || 0,
    experience: Number(criteria.experience) || 0,
    techStack: Number(criteria.techStack) || 0,
    seniority: Number(criteria.seniority) || 0,
    domain: Number(criteria.domain) || 0,
    other: Number(criteria.other) || 0
  };
  const weighted =
    SCORE_WEIGHTS.skills * c.skills +
    SCORE_WEIGHTS.experience * c.experience +
    SCORE_WEIGHTS.techStack * c.techStack +
    SCORE_WEIGHTS.seniority * c.seniority +
    SCORE_WEIGHTS.domain * c.domain +
    SCORE_WEIGHTS.other * c.other;
  return Math.round(weighted * 100) / 100;
}

/**
 * Map a single DeepSeek evaluation entry into the persisted profileMatchScores
 * shape. Includes a deterministic domain-mismatch penalty safety net:
 * when the evaluator marks coreRoleMatch = false, the final score is clamped to
 * at most 60% of the raw weighted criteria score (i.e., a 40% penalty inside the
 * mandated 30-50% band), so a mismatched candidate can never out-rank a matching
 * one even if the model over-credited their raw criterion scores. The applied
 * penalty is surfaced explicitly in the reasoning for full transparency.
 * @param {object} ev - evaluation entry from evaluateProfilesForJob
 * @param {object} [profile] - matching CandidateProfile (for name fallback)
 * @returns {{profileId, profileName, score, breakdown, reasoning}}
 */
function buildScoreEntry(ev, profile) {
  const criteria = ev.criteriaScores || {};
  const weighted = computeWeightedScore(criteria);
  const coreRoleMatches = ev.coreRoleMatch === true || String(ev.coreRoleMatch).toLowerCase() === 'true';

  let score = Number(ev.score);
  if (!Number.isFinite(score)) score = weighted;

  const roleNote = coreRoleMatches ? '[Core role: Matches]' : '[Core role: Mismatch]';
  const modelReasoning = (ev.reasoning || '').trim();

  let penaltyNote = '';
  if (!coreRoleMatches) {
    // 40% penalty (within the mandated 30-50% band) applied as a hard ceiling
    // over the raw weighted criteria score. If the model already applied a
    // stricter penalty (lower score), keep the model's lower score.
    const penalizedCeiling = Number((weighted * 0.6).toFixed(3));
    if (score > penalizedCeiling) score = penalizedCeiling;
    penaltyNote = '[Domain-mismatch penalty applied: 40% deduction]';
  }
  score = Number(Math.max(0, Math.min(100, score)).toFixed(3));

  return {
    profileId: ev.profileId,
    profileName: ev.profileName || ev.name || (profile && profile.name) || 'Unknown',
    score,
    breakdown: {
      skillsMatch: Number(criteria.skills) || 0,
      experienceMatch: Number(criteria.experience) || 0,
      technologyMatch: Number(criteria.techStack) || 0,
      seniorityMatch: Number(criteria.seniority) || 0,
      domainMatch: Number(criteria.domain) || 0,
      otherMatch: Number(criteria.other) || 0
    },
    reasoning: [roleNote, penaltyNote, modelReasoning].filter(Boolean).join(' ')
  };
}

/**
 * Deterministic micro-tiebreaker (0.001-0.009 on the 0-1 scale) derived from the
 * candidate's secondary-skill density and profile detail length, so no two
 * fallback scores collapse to an identical number. It is added BEFORE the hard
 * ceiling, keeping cross-domain caps (e.g., 20% for non-engineering candidates)
 * mathematically inviolable while still differentiating near-tied profiles.
 * @param {object} profile - CandidateProfile fields
 * @returns {number} tiebreaker boost in [0.001, 0.009]
 */
function computeDeterministicTiebreaker(profile) {
  const secondaryCount = Math.min((profile && Array.isArray(profile.secondarySkills) ? profile.secondarySkills.length : 0), 20);
  const detailLength = Math.min(profileToText(profile).length, 2000);
  const density = clamp((secondaryCount / 20) * 0.6 + (detailLength / 2000) * 0.4, 0, 1);
  return 0.001 + 0.008 * density;
}

/**
 * Deterministic baseline criteria for a candidate when the live LLM call is
 * offline or the candidate was omitted from the batch. Uses the Semantic
 * Functional-Domain categorizer with bounded ceilings:
 *   Final_Fallback_Score = Min(Hard_Domain_Ceiling, (Domain_Baseline * 0.7) + (Skill_Overlap * 0.3))
 * Software engineers on engineering jobs start from a 0.70 domain baseline
 * (core engineering transferability); non-engineering candidates (QA/Marketing/
 * Design) on those jobs are hard-capped at 0.20, so they can never win.
 * @returns {{criteria: {skills, experience, techStack, seniority, domain, other}, score: number, jobFunctionalDomain: string|null, candidateCategory: string|null, hardCeilingApplied: boolean}}
 */
function computeFallbackCriteria(profile, job, jobPrimaryRole) {
  const jobTitle = (job && job.title) || '';
  const jobDescription = `${jobTitle} ${String(job.descriptionText || job.description || '')}`;
  const jobFunctionalDomain = extractJobFunctionalDomain(jobDescription);
  const candidateCategory = classifyDomainCategory((profile && profile.professionalTitle) || '', profile);

  const skillOverlap = computeSkillOverlap(profile, job || {});
  const domainBaseline = computeDomainAlignmentMultiplier(jobFunctionalDomain, candidateCategory);
  const hardCeiling = computeHardDomainCeiling(jobFunctionalDomain, candidateCategory);

  // Final_Fallback_Score = Min(Hard_Domain_Ceiling, (Domain_Baseline * 0.7) + (Skill_Overlap * 0.3))
  // Full floating-point accuracy is retained across the weighted equation; a
  // deterministic micro-tiebreaker (0.001-0.009 on the 0-1 scale) is folded in
  // BEFORE the ceiling so no two fallback scores produce identical numbers while
  // cross-domain caps stay inviolable. Final score is rounded to 3 decimals.
  const domainComponent = domainBaseline * 0.7;
  const blended = domainComponent + (skillOverlap * 0.3);
  const rawScore = Math.min(hardCeiling, blended + computeDeterministicTiebreaker(profile));
  const score = Number((rawScore * 100).toFixed(3));

  const criteria = {
    skills: Math.round(skillOverlap * 100),
    experience: Math.round(((domainComponent + skillOverlap) / 2) * 100),
    techStack: Math.round(skillOverlap * 100),
    seniority: Math.round(((domainComponent + skillOverlap) / 2) * 100),
    domain: Math.round(Math.min(domainComponent, hardCeiling) * 100),
    other: Math.round(skillOverlap * 100)
  };
  return {
    criteria,
    score,
    jobFunctionalDomain,
    candidateCategory,
    hardCeilingApplied: hardCeiling < 1,
    domainBaseline
  };
}

/**
 * Construct a valid, persisted score entry for a candidate that DeepSeek
 * omitted or failed to score, guaranteeing profileMatchScores covers EVERY
 * profile fetched from MongoDB (no more "Not Scored" omissions). The entry
 * runs through the same deterministic domain-penalty layer as LLM entries.
 */
function buildFallbackEntry(profile, job, jobPrimaryRole) {
  const { criteria, score, jobFunctionalDomain, candidateCategory, hardCeilingApplied, domainBaseline } = computeFallbackCriteria(profile, job, jobPrimaryRole);
  const entry = {
    profileId: String(profile._id),
    profileName: profile.name || 'Unknown',
    score,
    breakdown: {
      skillsMatch: criteria.skills,
      experienceMatch: criteria.experience,
      technologyMatch: criteria.techStack,
      seniorityMatch: criteria.seniority,
      domainMatch: criteria.domain,
      otherMatch: criteria.other
    }
  };
  applyDeterministicDomainPenalty(entry, {
    jobPrimaryRole,
    candidatePrimaryDomain: extractCandidatePrimaryDomain(profile),
    hasCoreWebStack: hasCoreWebStack(profile),
    hasAIMLStack: hasAIMLStack(profile)
  });
  const baseReason = buildFallbackReasoning(profile, job, candidateCategory, domainBaseline, hardCeilingApplied, entry.score);
  entry.reasoning = entry.reasoning ? `${baseReason}\n${entry.reasoning}` : baseReason;
  console.log(`[PROFILE SCORING] Fallback evaluation for candidate: ${entry.profileName} (${getDomainCategoryLabel(candidateCategory)} for ${getFunctionalDomainLabel(jobFunctionalDomain)}) => ${entry.score}%`);
  return entry;
}

/**
 * Score all candidate profiles against a job and persist the recommendation.
 * @param {object} job - Mongoose document (UpworkJob or LinkedinJob)
 * @returns {Promise<null|{top: object, scores: Array}>} null when no profiles
 *   or no description; otherwise the ranked results.
 */
async function scoreProfilesForJob(job) {
  console.log('[PROFILE SCORING] Evaluating job:', job._id, 'Title:', job.title);

  const { title, description } = getJobText(job);
  if (!description) {
    console.log('[PROFILE SCORING] Job has no description. Skipping scoring for job:', job._id);
    return null;
  }

  const jobPrimaryRole = extractJobPrimaryRole(job);

  // Fetch ALL candidates from MongoDB — no brand/isActive/limit restrictions —
  // so every stored profile is evaluated in the DeepSeek batch and appears in
  // the dropdown. The full array (not a capped subset) is passed downstream.
  const allCandidates = await CandidateProfile.find({}).lean();

  // Deduplicate by normalized name so one person with multiple ingested resumes
  // is scored only once (keeps the most complete profile as representative).
  const candidates = dedupeCandidates(allCandidates);

  if (!candidates.length) {
    console.log('[PROFILE SCORING] No candidate profiles found. Skipping scoring for job:', job._id);
    return null;
  }
  if (candidates.length !== allCandidates.length) {
    console.log(`[PROFILE SCORING] Deduplicated candidates for job ${job._id}: ${allCandidates.length} -> ${candidates.length} unique`);
  }
  console.log('[PROFILE SCORING] Scoring', candidates.length, 'candidate(s) for job:', job._id);

  const evaluations = await evaluateProfilesForJob(title, description, candidates, {
    coreRoleCategory: inferCoreRoleCategory(job.title, job),
    requiredSkills: Array.isArray(job.skills) && job.skills.length ? job.skills : (Array.isArray(job.tags) ? job.tags : [])
  });

  // Map DeepSeek's evaluations by the candidate's exact _id string.
  const byProfileId = new Map();
  for (const ev of evaluations || []) {
    if (!ev || !ev.profileId) continue;
    const profile = allCandidates.find((p) => String(p._id) === String(ev.profileId));
    const entry = buildScoreEntry(ev, profile);
    applyDeterministicDomainPenalty(entry, {
      jobPrimaryRole,
      candidatePrimaryDomain: profile ? extractCandidatePrimaryDomain(profile) : null,
      hasCoreWebStack: profile ? hasCoreWebStack(profile) : false,
      hasAIMLStack: profile ? hasAIMLStack(profile) : false
    });
    byProfileId.set(String(ev.profileId), entry);
  }

  // Fallback score guarantee: EVERY candidate fetched from MongoDB gets a valid
  // score entry. Candidates the live DeepSeek call scored keep their authentic
  // LLM reasoning verbatim — buildFallbackEntry runs ONLY for candidates the
  // live call omitted or failed, so live reasoning is never overwritten.
  const scores = dedupeScoreEntries(
    candidates
      .map((candidate) => byProfileId.get(String(candidate._id)) || buildFallbackEntry(candidate, job, jobPrimaryRole))
  )
    // Strict descending sort on the FINAL adjusted score: the true domain match
    // always wins aiRecommendedProfileId.
    .sort((a, b) => b.score - a.score);

  if (!scores.length) {
    console.log('[PROFILE SCORING] No valid evaluations returned for job:', job._id);
    return null;
  }

  const top = scores[0];
  const update = {
    aiRecommendedProfileId: top.profileId,
    aiRecommendedScore: top.score,
    profileMatchScores: scores,
    profileSelectionReasoning: top.reasoning || ''
  };
  if (job.selectionSource === 'MANUAL_OVERRIDE') {
    // Never clobber an explicit human selection with an AI re-pick.
    console.log('[PROFILE SCORING] Manual override present; preserving selection for job:', job._id);
  } else {
    update.selectedProfileId = top.profileId;
    update.selectionSource = 'AI_RECOMMENDED';
  }

  await job.updateOne({ $set: update });
  job.profileMatchScores = scores;
  console.log(`[PROFILE SCORING COMPLETE] Scored ${job.profileMatchScores.length} / ${candidates.length} profiles for job ${job._id} | Top candidate score: ${top.score}`);
  console.log('[PROFILE SCORING] Winner:', top.profileName, 'Score:', top.score + '%');
  return { top, scores };
}

/**
 * Fire-and-forget scoring for a batch of stored jobs. Skips jobs that were
 * already scored so re-scrapes never re-score existing recommendations.
 * @param {Array<string>} jobIds
 * @param {import('mongoose').Model} JobModel
 * @returns {Promise<Array>} results of successful scoring runs
 */
async function scoreJobs(jobIds, JobModel) {
  const results = [];
  for (const id of jobIds || []) {
    try {
      const job = await JobModel.findById(id);
      if (!job || job.aiRecommendedProfileId) continue;
      const result = await scoreProfilesForJob(job);
      if (result) results.push(result);
    } catch (err) {
      console.error('[PROFILE SCORING] Background scoring error for job:', id, err.message);
    }
  }
  return results;
}

module.exports = {
  scoreProfilesForJob,
  scoreJobs,
  computeWeightedScore,
  buildScoreEntry,
  computeFallbackCriteria,
  buildFallbackEntry,
  inferCoreRoleCategory,
  extractJobPrimaryRole,
  extractCandidatePrimaryDomain,
  hasCoreWebStack,
  hasAIMLStack,
  applyDeterministicDomainPenalty,
  classifyDomainCategory,
  mapJobRoleToCategory,
  getDomainAffinity,
  computeSkillOverlap,
  extractJobFunctionalDomain,
  computeDomainAlignmentMultiplier,
  computeHardDomainCeiling,
  computeTaskPillars,
  dedupeCandidates,
  SCORE_WEIGHTS
};