/**
 * Lead Qualifier — Step 2 of the Sales Agent pipeline
 *
 * Scores each lead 1–10 based on how well they match Co-Ventech's
 * ideal customer profile (QA/test automation services buyer).
 * Only leads scoring >= QUALIFY_THRESHOLD pass to outreach.
 */

const QUALIFY_THRESHOLD = 6;

// Industries and their match scores
const INDUSTRY_SCORES = {
  // Tier 1 — highest need for QA automation
  'computer software': 10, 'saas': 10, 'internet': 9,
  'financial services': 9, 'fintech': 9,
  'hospital & health care': 9, 'health, wellness and fitness': 8, 'medical devices': 8,
  'information technology and services': 8,

  // Tier 2 — good fit
  'logistics and supply chain': 7, 'transportation/trucking/railroad': 7,
  'e-commerce': 7, 'retail': 6,
  'automotive': 7, 'telecommunications': 6,
  'education management': 6, 'e-learning': 6,
  'cybersecurity': 8, 'blockchain & cryptocurrency': 7,

  // Default for unrecognized industries
  _default: 4
};

// Seniority scores — we want decision makers, not doers
const SENIORITY_SCORES = {
  'c_suite': 10, 'founder': 10, 'owner': 10,
  'vp': 9, 'director': 8, 'head': 8,
  'manager': 6, 'senior': 4, 'partner': 7,
  _default: 3
};

// Company size scores — sweet spot is 21–500 employees (startup/midmarket)
const SIZE_SCORES = {
  '2-10':    3,
  '11-20':   6,
  '21-50':   9,
  '51-100':  10,
  '101-200': 9,
  '201-500': 8,
  '501-1000':5,
  '1001-2000':3,
  '2001-5000':2,
  '5001-10000':1,
  '10000+':  1,
  _default:  5
};

// Geography scores
const GEO_SCORES = {
  'united states': 10, 'usa': 10, 'us': 10,
  'canada': 9,
  'united arab emirates': 9, 'uae': 9,
  'saudi arabia': 9,
  'qatar': 8,
  'kuwait': 8,
  'bahrain': 8,
  'oman': 8,
  'australia': 8,
  'united kingdom': 7, 'uk': 7,
  'germany': 6, 'netherlands': 6,
  _default: 4
};

// High-intent technology signals — already investing in test automation
const HIGH_INTENT_TECH = [
  'selenium', 'cypress', 'playwright', 'appium', 'testng',
  'pytest', 'jest', 'mocha', 'jenkins', 'github actions',
  'circleci', 'jira', 'postman', 'k6', 'jmeter'
];

class LeadQualifier {
  constructor(logger, threshold = QUALIFY_THRESHOLD) {
    this.logger = logger;
    this.threshold = threshold;
  }

  /**
   * Score a single lead
   * @param {object} lead - raw lead from Apify
   * @returns {{ score: number, breakdown: object, qualified: boolean }}
   */
  scoreLead(lead) {
    const breakdown = {};

    // 1. Email validation — hard requirement (0 = discard)
    if (!lead.email || !this._isValidEmail(lead.email)) {
      return { score: 0, breakdown: { email: 'invalid — discarded' }, qualified: false };
    }

    // 2. Industry match (30% weight → max 3 points)
    const industryRaw = (lead.industry || '').toLowerCase();
    const industryKey = Object.keys(INDUSTRY_SCORES).find(k => industryRaw.includes(k)) || '_default';
    breakdown.industry = INDUSTRY_SCORES[industryKey];

    // 3. Seniority (25% weight → max 2.5 points)
    const seniorityRaw = (lead.seniority || lead.job_title || '').toLowerCase();
    const seniorityKey = Object.keys(SENIORITY_SCORES).find(k => seniorityRaw.includes(k.replace('_', ' '))) || '_default';
    breakdown.seniority = SENIORITY_SCORES[seniorityKey];

    // 4. Company size (20% weight → max 2 points)
    const empCount = lead.employee_count || 0;
    breakdown.company_size = this._sizeScore(empCount);

    // 5. Geography (15% weight → max 1.5 points)
    const countryRaw = (lead.headquarters_country || lead.country || '').toLowerCase();
    const geoKey = Object.keys(GEO_SCORES).find(k => countryRaw.includes(k)) || '_default';
    breakdown.geography = GEO_SCORES[geoKey];

    // 6. Technology signal bonus (+1 if company uses QA/CI tools)
    const techStack = (lead.technology_stack || []).map(t => t.toLowerCase());
    const hasQATech = HIGH_INTENT_TECH.some(t => techStack.some(s => s.includes(t)));
    breakdown.tech_bonus = hasQATech ? 10 : 0;

    // Weighted final score
    const score = Math.round(
      (breakdown.industry    * 0.30) +
      (breakdown.seniority   * 0.25) +
      (breakdown.company_size * 0.20) +
      (breakdown.geography   * 0.15) +
      (breakdown.tech_bonus  * 0.10)
    );

    const qualified = score >= this.threshold;

    if (!qualified) {
      this.logger.debug(`  SKIP ${lead.organization_name || lead.company_name} (${score}/10): ${JSON.stringify(breakdown)}`);
    }

    return { score, breakdown, qualified };
  }

  /**
   * Filter and score an array of leads
   * @param {Array} leads
   * @returns {{ qualified: Array, rejected: Array, stats: object }}
   */
  qualifyBatch(leads) {
    const qualified = [];
    const rejected  = [];

    for (const lead of leads) {
      const result = this.scoreLead(lead);
      const enriched = { ...lead, _score: result.score, _score_breakdown: result.breakdown };
      if (result.qualified) {
        qualified.push(enriched);
      } else {
        rejected.push(enriched);
      }
    }

    const stats = {
      total:     leads.length,
      qualified: qualified.length,
      rejected:  rejected.length,
      rate:      leads.length > 0 ? Math.round((qualified.length / leads.length) * 100) : 0,
      avg_score: qualified.length > 0
        ? Math.round(qualified.reduce((s, l) => s + l._score, 0) / qualified.length)
        : 0
    };

    this.logger.info(`Lead qualification: ${stats.qualified}/${stats.total} qualified (${stats.rate}%) — avg score: ${stats.avg_score}/10`);

    if (stats.rate < 10) {
      this.logger.warn('Qualification rate below 10% — review campaign targeting');
    }

    return { qualified, rejected, stats };
  }

  _sizeScore(empCount) {
    if (!empCount || empCount === 0) return SIZE_SCORES._default;
    if (empCount <= 10)   return SIZE_SCORES['2-10'];
    if (empCount <= 20)   return SIZE_SCORES['11-20'];
    if (empCount <= 50)   return SIZE_SCORES['21-50'];
    if (empCount <= 100)  return SIZE_SCORES['51-100'];
    if (empCount <= 200)  return SIZE_SCORES['101-200'];
    if (empCount <= 500)  return SIZE_SCORES['201-500'];
    if (empCount <= 1000) return SIZE_SCORES['501-1000'];
    if (empCount <= 2000) return SIZE_SCORES['1001-2000'];
    if (empCount <= 5000)  return SIZE_SCORES['2001-5000'];
    if (empCount <= 10000) return SIZE_SCORES['5001-10000'];
    return SIZE_SCORES['10000+'];
  }

  _isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }
}

module.exports = { LeadQualifier, QUALIFY_THRESHOLD };
