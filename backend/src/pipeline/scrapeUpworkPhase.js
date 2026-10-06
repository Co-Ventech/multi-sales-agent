/**
 * scrapeUpworkPhase.js
 *
 * Three-step Upwork enrichment pipeline:
 *   STEP 1 — Run Upwork Job Scraper to fetch job postings
 *   STEP 2 — Check cached LinkedIn contacts for company names; for new companies call Employees actor
 *   STEP 3 — Cartesian product: one Contact per (job × HR email)
 *
 * Supports cron mode: reads config from brand.apify.defaultInput
 */

const UpworkJob = require('../models/UpworkJob');
const LinkedinContact = require('../models/LinkedinContact');
const { upsertEnrichedContact } = require('./enrichedContactUpsert');
const { runActor, mapEmployeesToContacts } = require('../services/apifyService');
const {
  getApifyToken,
  capUpworkPipelineInput,
  applyUpworkJobLocations,
  MAX_JOB_SCRAPE_ITEMS
} = require('../config/apify');
const { filterUpworkJobsForBrand } = require('../config/apifyUpworkLocationFilters');
const { filterJobsForDomain } = require('../config/apifyJobDomainFilters');

/** Fallback Upwork query covering the 5 target tech domains (used when brand query is empty). */
const DEFAULT_UPWORK_JOBS_QUERY = [
  'software engineer', 'full stack', 'frontend', 'backend', 'web development', 'mobile developer',
  'qa engineer', 'automation tester', 'software testing',
  'devops', 'ci/cd', 'cloud engineer', 'site reliability',
  'security engineer', 'cybersecurity', 'information security',
  'ai engineer', 'machine learning', 'data scientist', 'generative ai', 'llm'
].join(' OR ');

const DEFAULT_UPWORK_JOBS_INPUT = {
  sort: 'newest',
  per_page: MAX_JOB_SCRAPE_ITEMS,
  query: DEFAULT_UPWORK_JOBS_QUERY
};
const { extractAll, isGoodCompanyName } = require('../services/extractCompanyFromText');

const UPWORK_ACTOR = 'XYTgO05GT5qAoSlxy';
const LINKEDIN_EMPLOYEES_ACTOR = 'Vb6LZkh4EqRlR0Ka9';

const DEFAULT_EMPLOYEE_INPUT = {
  functionIds: ['12'],
  profileScraperMode: 'Full + email search ($12 per 1k)',
  recentlyChangedJobs: false,
  maxItems: 10
};


// ── Helpers ────────────────────────────────────────────────────────────────────

function fuzzyMatch(needle, haystack) {
  const n = (needle || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const h = (haystack || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  if (!n || !h) return false;
  if (n === h) return true;
  if (h.includes(n) || n.includes(h)) return true;
  const nFirst = n.split(/\s+/)[0];
  const hFirst = h.split(/\s+/)[0];
  if (nFirst && hFirst && (nFirst === hFirst || hFirst.length > 2 && (hFirst.startsWith(nFirst) || nFirst.startsWith(hFirst)))) return true;
  return false;
}

function normalize(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// ── Main Phase ─────────────────────────────────────────────────────────────────

/**
 * @param {object} brand  - Brand mongoose document
 * @param {object} logger - Run logger with info/warn/error methods
 * @param {object} opts    - Override options:
 *   - actorInput     {object}  - Upwork actor input (merges with brand defaults)
 *   - employeeInput {object}  - LinkedIn Employees input (merges with defaults)
 */
async function scrapeUpworkPhase(brand, logger, opts = {}) {
  logger.info('--- SCRAPE-UPWORK PHASE ---');

  const apiToken = getApifyToken(brand);
  if (!apiToken) {
    logger.error('No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env');
    return { companiesMatched: 0, contactsCreated: 0, jobsStored: 0, employeesFound: 0, rawJobs: 0 };
  }

  // STEP 1 — Upwork Jobs
  const baseInput = brand.apify?.defaultInput || {};
  const actorInput = capUpworkPipelineInput(
    applyUpworkJobLocations(
      {
        ...DEFAULT_UPWORK_JOBS_INPUT,
        ...baseInput,
        ...(opts.actorInput || {})
      },
      brand
    )
  );

  // Guarantee a domain-scoped query even when the brand preset has no query.
  if (!actorInput.query) {
    actorInput.query = DEFAULT_UPWORK_JOBS_QUERY;
  }

  const locs = Array.isArray(actorInput.location) ? actorInput.location : [actorInput.location].filter(Boolean);
  logger.info(
    `STEP 1 — Running Upwork Job Scraper (per_page=${actorInput.per_page}, locations=${locs.join(', ')})`
  );

  let rawJobItems;
  try {
    rawJobItems = await runActor(apiToken, UPWORK_ACTOR, actorInput);
  } catch (err) {
    logger.error(`Upwork actor failed: ${err.message}`);
    return { companiesMatched: 0, contactsCreated: 0, jobsStored: 0, employeesFound: 0, rawJobs: 0 };
  }

  let rawJobs = (Array.isArray(rawJobItems) ? rawJobItems : []).slice(0, MAX_JOB_SCRAPE_ITEMS);
  const locationFilter = filterUpworkJobsForBrand(rawJobs, brand);
  if (locationFilter.dropped > 0) {
    logger.info(
      `Upwork location filter: kept ${locationFilter.kept}/${rawJobs.length} ` +
      `(${locationFilter.dropped} dropped — client location must be in: ${locationFilter.allowedLocations.join(', ')})`
    );
  }
  rawJobs = locationFilter.items;

  // Tech-domain filter: keep only jobs matching the 5 target domains.
  const domainFilter = filterJobsForDomain(rawJobs, brand);
  if (domainFilter.dropped > 0) {
    logger.info(
      `Upwork domain filter: kept ${domainFilter.kept}/${rawJobs.length} ` +
      `(${domainFilter.dropped} dropped — not in target domains: ${domainFilter.domains.join(', ')})`
    );
  }
  rawJobs = domainFilter.items;

  if (rawJobs.length === 0) {
    logger.warn(
      locationFilter.dropped > 0
        ? `No jobs left after Upwork location filter (${locationFilter.dropped} dropped)`
        : domainFilter.dropped > 0
          ? `No jobs left after Upwork domain filter (${domainFilter.dropped} dropped)`
          : 'No jobs returned from Upwork actor'
    );
    return { companiesMatched: 0, contactsCreated: 0, jobsStored: 0, employeesFound: 0, rawJobs: 0 };
  }

  // ── Extract company names from descriptions ───────────────────────────────
  const jobCompanyMap = new Map();  // url -> company name
  const companyNames = new Set();

  for (const raw of rawJobs) {
    if (!raw.url) continue;

    // Use regex to extract company name from description
    const { company: descCompany } = extractAll(raw.description || '');

    const bestCompany = (descCompany && isGoodCompanyName(descCompany)) ? descCompany : null;

    if (bestCompany) {
      companyNames.add(bestCompany);
      jobCompanyMap.set(raw.url, bestCompany);
    }
  }

  logger.info(`Companies found: ${companyNames.size}`);

  // ── Store UpworkJob records ─────────────────────────────────────────────
  let jobsStored = 0;
  for (const raw of rawJobs) {
    try {
      await UpworkJob.findOneAndUpdate(
        { brandId: brand._id, jobId: raw.id || raw.subId || raw.url },
        { $set: {
          brandId: brand._id,
          jobId: raw.id || raw.subId || raw.url,
          url: raw.url || '',
          title: raw.title || '',
          description: raw.description || '',
          budget: raw.budget || null,
          clientLocation: raw.clientLocation || '',
          clientName: raw.clientName || null,
          clientNameConfidence: raw.clientNameConfidence || null,
          clientAvgHourlyRate: raw.clientAvgHourlyRate || null,
          clientRating: raw.clientRating || null,
          clientHireRatePercent: raw.clientHireRatePercent || null,
          clientTotalSpent: raw.clientTotalSpent || null,
          hasHired: raw.hasHired || false,
          proposals: raw.proposals || null,
          paymentVerified: raw.paymentVerified || false,
          relativeDate: raw.relativeDate || '',
          absoluteDate: raw.absoluteDate || '',
          jobType: raw.jobType || '',
          experienceLevel: raw.experienceLevel || '',
          allowedApplicantCountries: raw.allowedApplicantCountries || [],
          tags: raw.tags || [],
          questions: raw.questions || [],
          status: 'new'
        }},
        { upsert: true, new: true }
      );
      jobsStored++;
    } catch (err) {
      logger.error(`UpworkJob upsert error: ${err.message}`);
    }
  }
  logger.info(`Jobs stored: ${jobsStored}`);

  if (companyNames.size === 0) {
    logger.warn('No companies found in job results');
    return { companiesMatched: 0, contactsCreated: 0, jobsStored, employeesFound: 0, rawJobs: rawJobs.length };
  }

  // ── STEP 2 — Check cached employees + fetch new companies ────────────────
  const companyList = [...companyNames].slice(0, 5); // cap at 5 for free tier

  // Build employees map from cached DB records
  const employeesByCompany = {};  // normalized companyName -> employees[]

  for (const companyName of companyList) {
    const normalized = normalize(companyName);

    // Check DB for existing LinkedIn contacts for this company
    const cached = await LinkedinContact.find({
      brandId: brand._id,
      companyName: { $regex: new RegExp(`^${normalized}$`, 'i') }
    }).lean();

    if (cached.length > 0) {
      employeesByCompany[normalized] = cached.map(c => ({
        email: c.email,
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        fullName: c.fullName || '',
        jobTitle: c.jobTitle || '',
        headline: c.headline || '',
        linkedinUrl: c.linkedinUrl || '',
        companyName: c.companyName || '',
        companyLinkedin: c.companyLinkedin || '',
        industry: c.industry || '',
        companySize: c.companySize || '',
        companyWebsite: c.companyWebsite || '',
        city: c.city || '',
        state: c.state || '',
        country: c.country || '',
        fromCache: true
      }));
      logger.info(`Using ${cached.length} cached emails for "${companyName}"`);
    }
  }

  // Find companies without cached employees
  const companiesNeedingLookup = companyList.filter(c => !employeesByCompany[normalize(c)]);

  if (companiesNeedingLookup.length > 0) {
    logger.info(`STEP 2 — Running LinkedIn Employees Actor for ${companiesNeedingLookup.length} new companies: ${companiesNeedingLookup.join(', ')}`);

    const empInput = { ...DEFAULT_EMPLOYEE_INPUT, ...(opts.employeeInput || {}) };

    let rawEmpItems;
    try {
      rawEmpItems = await runActor(apiToken, LINKEDIN_EMPLOYEES_ACTOR, {
        ...empInput,
        companies: companiesNeedingLookup
      });
    } catch (err) {
      logger.error(`Employees actor failed: ${err.message}`);
      return { companiesMatched: 0, contactsCreated: 0, jobsStored, employeesFound: 0, rawJobs: rawJobs.length };
    }

    const newEmployees = mapEmployeesToContacts(rawEmpItems);
    logger.info(`New employees with emails: ${newEmployees.length}`);

    // Store new LinkedinContact records and add to employeesByCompany map
    for (const emp of newEmployees) {
      if (!emp.companyName) continue;

      // Create/Update LinkedinContact
      let existingLc = await LinkedinContact.findOne({ brandId: brand._id, email: emp.email });
      if (existingLc) {
        existingLc.companyName = emp.companyName;
        existingLc.companyLinkedin = emp.companyLinkedin || existingLc.companyLinkedin;
        existingLc.jobTitle = emp.jobTitle || existingLc.jobTitle;
        await existingLc.save();
      } else {
        await LinkedinContact.create({
          brandId: brand._id,
          email: emp.email,
          firstName: emp.firstName || '',
          lastName: emp.lastName || '',
          fullName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
          jobTitle: emp.jobTitle || '',
          headline: emp.headline || '',
          linkedinUrl: emp.linkedinUrl || '',
          companyName: emp.companyName || '',
          companyLinkedin: emp.companyLinkedin || '',
          industry: emp.industry || '',
          companySize: emp.companySize || '',
          companyWebsite: emp.companyWebsite || '',
          city: emp.city || '',
          state: emp.state || '',
          country: emp.country || '',
          status: 'Pending'
        });
      }

      // Add to employeesByCompany
      const key = normalize(emp.companyName);
      if (!employeesByCompany[key]) employeesByCompany[key] = [];
      employeesByCompany[key].push({ ...emp, fromCache: false });
    }
  }

  const totalEmployees = Object.values(employeesByCompany).reduce((sum, emps) => sum + emps.length, 0);
  logger.info(`Total employees available: ${totalEmployees}`);

  if (totalEmployees === 0) {
    logger.warn('No employees with emails found — stopping');
    return { companiesMatched: 0, contactsCreated: 0, jobsStored, employeesFound: 0, rawJobs: rawJobs.length };
  }

  // ── STEP 3 — Match companies and create Contacts ───────────────────────────
  logger.info('STEP 3 — Matching companies and storing contacts');

  let companiesMatched = 0;
  let contactsCreated = 0;

  // Group raw jobs by company name
  const jobsByCompany = {};
  for (const raw of rawJobs) {
    const name = jobCompanyMap.get(raw.url);
    if (!name) continue;
    if (!jobsByCompany[name]) jobsByCompany[name] = [];
    jobsByCompany[name].push(raw);
  }

  for (const [companyName, companyJobs] of Object.entries(jobsByCompany)) {
    // Find employees using fuzzy matching
    let matchedEmployees = [];
    const companyKey = normalize(companyName);

    for (const [empKey, emps] of Object.entries(employeesByCompany)) {
      if (fuzzyMatch(companyName, empKey)) {
        matchedEmployees = emps;
        break;
      }
    }

    if (matchedEmployees.length === 0) continue;

    companiesMatched++;

    // Save UpworkJob IDs for linking
    const allJobIds = [];
    for (const job of companyJobs) {
      const savedJob = await UpworkJob.findOne({ brandId: brand._id, jobId: job.id || job.subId || job.url });
      if (savedJob) allJobIds.push(savedJob._id);
    }

    // Create Cartesian product: one Contact per (job × employee email)
    for (const job of companyJobs) {
      const savedJob = await UpworkJob.findOne({ brandId: brand._id, jobId: job.id || job.subId || job.url });
      if (!savedJob) continue;

      for (const emp of matchedEmployees) {
        const { created } = await upsertEnrichedContact(brand._id, {
          email: emp.email,
          firstName: emp.firstName || '',
          lastName: emp.lastName || '',
          fullName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
          jobTitle: job.title || '',
          linkedinUrl: emp.linkedinUrl || '',
          jobLinkedinUrl: job.url || '',
          companyName: companyName || '',
          companyLinkedin: emp.companyLinkedin || '',
          industry: emp.industry || '',
          companySize: emp.companySize || '',
          companyWebsite: emp.companyWebsite || '',
          city: emp.city || '',
          state: emp.state || '',
          country: emp.country || '',
          status: 'Pending',
          importSource: 'upwork-enriched',
          upworkJobIds: [savedJob._id],
          linkedinContactId: emp._id
        });
        if (created) contactsCreated++;
      }
    }
  }

  logger.info(`Results: ${companiesMatched} companies matched, ${contactsCreated} contacts created, ${jobsStored} jobs stored`);

  return {
    companiesMatched,
    contactsCreated,
    jobsStored,
    employeesFound: totalEmployees,
    rawJobs: rawJobs.length,
    droppedJobs: rawJobs.length - jobsStored
  };
}

module.exports = scrapeUpworkPhase;