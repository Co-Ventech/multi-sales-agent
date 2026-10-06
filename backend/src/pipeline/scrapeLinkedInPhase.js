/**
 * scrapeLinkedInPhase.js
 *
 * Two-step LinkedIn enrichment pipeline:
 *   STEP 1 — Run LinkedIn Jobs actor to fetch job postings
 *   STEP 2 — Run LinkedIn Employees actor to find HR emails per company
 *   STEP 3 — Cartesian product: one Contact per (job × HR email)
 *
 * Supports two modes:
 *   - cron mode: reads config from brand.apify.linkedinJobsDefaultInput
 *   - API mode: accepts input overrides (used by /import-enriched-jobs route)
 */

const LinkedinJob = require('../models/LinkedinJob');
const LinkedinContact = require('../models/LinkedinContact');
const { runActor, mapLinkedInJobsToContacts, mapEmployeesToContacts, mapToLinkedinJob } = require('../services/apifyService');
const {
  getApifyToken,
  buildLinkedInJobsActorInput,
  DEFAULT_LINKEDIN_JOB_LOCATIONS,
  MAX_JOB_SCRAPE_ITEMS,
  MAX_LINKEDIN_EMPLOYEE_COMPANIES_DEFAULT
} = require('../config/apify');
const {
  filterLinkedInJobsForBrand,
  shouldFilterLinkedinJobsByLocation,
  isLinkedinStandardBrand
} = require('../config/apifyLinkedinLocationFilters');
const { isLinkedinGulfBrand } = require('../config/apifyLinkedinGulfFilters');
const { filterJobsForDomain } = require('../config/apifyJobDomainFilters');
const { upsertEnrichedContact } = require('./enrichedContactUpsert');

const LINKEDIN_JOBS_ACTOR = 'zn01OAlzP853oqn4Z';
const LINKEDIN_EMPLOYEES_ACTOR = 'Vb6LZkh4EqRlR0Ka9';

const DEFAULT_JOBS_INPUT = {
  easyApply: false,
  employmentType: ['full-time', 'part-time'],
  experienceLevel: ['executive', 'director', 'mid-senior', 'associate'],
  jobTitles: ['Software Engineer', 'Full Stack Developer', 'QA Engineer', 'Test Automation', 'DevOps Engineer', 'Cybersecurity', 'AI Engineer'],
  locations: [...DEFAULT_LINKEDIN_JOB_LOCATIONS],
  maxItems: 100,
  postedLimit: '24h',
  sortBy: 'date',
  under10Applicants: false,
  workplaceType: ['remote']
};

const DEFAULT_EMPLOYEE_INPUT = {
  functionIds: ['12'],
  profileScraperMode: 'Full + email search ($12 per 1k)',
  recentlyChangedJobs: false,
  maxItems: 10  // capped at 10 for free tier limit
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeLinkedinUrl(url) {
  if (!url) return '';
  return url.replace(/\/$/, '').replace(/\/company\//i, '/company/');
}

function extractRootBrand(name) {
  if (!name) return '';
  return name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
}

function extractDomain(website) {
  if (!website) return '';
  try {
    const u = new URL(website);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  }
}

function buildCompanyKey(obj) {
  return {
    linkedin: normalizeLinkedinUrl(obj.companyLinkedin),
    rootBrand: extractRootBrand(obj.companyName),
    domain: extractDomain(obj.companyWebsite)
  };
}

function findMatchingCompanyUrl(jobKey, employeesByUrl) {
  if (jobKey.linkedin && employeesByUrl[jobKey.linkedin]) return jobKey.linkedin;

  if (jobKey.domain) {
    for (const [empUrl, emps] of Object.entries(employeesByUrl)) {
      const empKey = buildCompanyKey(emps[0] || {});
      if (empKey.domain && (empKey.domain === jobKey.domain ||
          empKey.domain.endsWith('.' + jobKey.domain) || jobKey.domain.endsWith('.' + empKey.domain))) {
        return empUrl;
      }
    }
  }

  if (jobKey.rootBrand && jobKey.rootBrand.length >= 4) {
    for (const [empUrl, emps] of Object.entries(employeesByUrl)) {
      const empKey = buildCompanyKey(emps[0] || {});
      if (empKey.rootBrand === jobKey.rootBrand) return empUrl;
    }
  }

  return null;
}

// Fuzzy cache lookup: check all cached LinkedInContact records for a company
// and return the best match using domain, root brand, or exact URL.
// Returns { cached: LinkedinContact[], matchedUrl: string | null }
async function findCachedEmployeesForCompany(jobKey, brandId) {
  // Try exact URL first
  if (jobKey.linkedin) {
    const exact = await LinkedinContact.find({
      brandId, companyLinkedin: jobKey.linkedin
    }).lean();
    if (exact.length > 0) return { cached: exact, matchedUrl: jobKey.linkedin };
  }

  // Try domain match — check if any cached record's domain matches the job's domain
  if (jobKey.domain) {
    const allCached = await LinkedinContact.find({ brandId }).lean();
    for (const c of allCached) {
      if (!c.companyWebsite) continue;
      const cachedDomain = extractDomain(c.companyWebsite);
      if (cachedDomain &&
          (cachedDomain === jobKey.domain ||
           cachedDomain.endsWith('.' + jobKey.domain) ||
           jobKey.domain.endsWith('.' + cachedDomain))) {
        // Found domain match — collect all with same domain
        const domainKey = cachedDomain;
        const sameDomain = allCached.filter(c2 => {
          const d = extractDomain(c2.companyWebsite);
          return d && (d === domainKey || d.endsWith('.' + domainKey) || domainKey.endsWith('.' + d));
        });
        return { cached: sameDomain, matchedUrl: c.companyLinkedin || c.companyWebsite || cachedDomain };
      }
    }
  }

  // Try root brand match
  if (jobKey.rootBrand && jobKey.rootBrand.length >= 4) {
    const allCached = await LinkedinContact.find({ brandId }).lean();
    for (const c of allCached) {
      if (!c.companyName) continue;
      const cachedRoot = extractRootBrand(c.companyName);
      if (cachedRoot && cachedRoot === jobKey.rootBrand) {
        const sameRoot = allCached.filter(c2 => {
          const r = extractRootBrand(c2.companyName || '');
          return r && r === cachedRoot;
        });
        return { cached: sameRoot, matchedUrl: c.companyLinkedin || null };
      }
    }
  }

  return { cached: [], matchedUrl: null };
}

// ── Main Phase ────────────────────────────────────────────────────────────────

/**
 * @param {object} brand  - Brand mongoose document
 * @param {object} logger - Run logger with info/warn/error methods
 * @param {object} opts    - Override options:
 *   - jobsInput       {object}  - LinkedIn Jobs input (merges with brand defaults)
 *   - employeeInput   {object}  - LinkedIn Employees input (merges with defaults)
 *   - companyUrls     {string[]} - Optional: limit to specific company URLs
 */
async function scrapeLinkedInPhase(brand, logger, opts = {}) {
  logger.info('--- SCRAPE-LINKEDIN PHASE ---');

  const apiToken = getApifyToken(brand);
  if (!apiToken) {
    logger.error('No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env');
    return { companiesMatched: 0, contactsCreated: 0, jobsStored: 0, employeesFound: 0, rawJobs: 0 };
  }

  // STEP 1 — Jobs
  const savedJobs = brand.apify?.linkedinJobsDefaultInput || {};
  const jobsInput = buildLinkedInJobsActorInput({
    ...DEFAULT_JOBS_INPUT,
    ...savedJobs,
    ...(opts.jobsInput || {})
  });
  const meta = jobsInput._scrapeMeta || {};
  delete jobsInput._scrapeMeta;

  if (!jobsInput.jobTitles?.length) {
    logger.error('LinkedIn jobs actor requires at least one job title');
    return { companiesMatched: 0, contactsCreated: 0, jobsStored: 0, employeesFound: 0, rawJobs: 0 };
  }

  logger.info(
    `STEP 1 — LinkedIn Jobs Actor: ${meta.titlesUsed || jobsInput.jobTitles.length} titles × ${meta.locationsUsed || jobsInput.locations.length} location(s), ` +
    `maxItems=${jobsInput.maxItems}/query (~${meta.maxTotal || MAX_JOB_SCRAPE_ITEMS} total), locations=${jobsInput.locations?.join(', ')}`
  );

  let rawJobItems;
  try {
    rawJobItems = await runActor(apiToken, LINKEDIN_JOBS_ACTOR, {
      ...jobsInput,
      searchQueries: jobsInput.searchQueries || jobsInput.jobTitles
    });
  } catch (err) {
    logger.error(`Jobs actor failed: ${err.message}`);
    return { companiesMatched: 0, contactsCreated: 0, jobsStored: 0, employeesFound: 0, rawJobs: 0 };
  }

  const jobCap = meta.maxTotal || MAX_JOB_SCRAPE_ITEMS;
  const apifyCount = Array.isArray(rawJobItems) ? rawJobItems.length : 0;
  let rawJobs = Array.isArray(rawJobItems) ? rawJobItems : [];

  // Location filter (standard LinkedIn + Gulf): evaluate ALL Apify results, then cap.
  const locationFilter = filterLinkedInJobsForBrand(rawJobs, brand);
  const usesLocationFilter = shouldFilterLinkedinJobsByLocation(brand);

  if (usesLocationFilter) {
    logger.info(
      `${isLinkedinGulfBrand(brand) ? 'Gulf' : 'Location'} filter: kept ${locationFilter.kept}/${apifyCount} jobs ` +
      `(${locationFilter.dropped} dropped — must be in: ${locationFilter.allowedLocations?.join(', ')})`
    );
    rawJobs = locationFilter.items.slice(0, jobCap);
    if (locationFilter.kept > jobCap) {
      logger.info(`Job cap: using ${jobCap} of ${locationFilter.kept} matched jobs (${locationFilter.kept - jobCap} over cap)`);
    }
  } else {
    rawJobs = rawJobs.slice(0, jobCap);
  }

  const jobsCapDropped = usesLocationFilter
    ? Math.max(0, locationFilter.kept - rawJobs.length)
    : Math.max(0, apifyCount - rawJobs.length);

  // Tech-domain filter: keep only jobs matching the 5 target domains.
  // titleStrict: a non-domain title (Finance, Biomedical, Sales...) is rejected
  // outright, and a positive title match is required to keep a job.
  const domainFilter = filterJobsForDomain(rawJobs, brand, { titleStrict: true });
  if (domainFilter.dropped > 0) {
    logger.info(
      `Domain filter: kept ${domainFilter.kept}/${rawJobs.length} jobs ` +
      `(${domainFilter.dropped} dropped — not in target domains: ${domainFilter.domains.join(', ')})`
    );
  }
  rawJobs = domainFilter.items;

  let gulfJobsStored = 0;
  if (isLinkedinGulfBrand(brand) && rawJobs.length > 0) {
    for (const raw of rawJobs) {
      if (!raw.linkedinUrl) continue;
      try {
        await LinkedinJob.findOneAndUpdate(
          { brandId: brand._id, linkedinUrl: raw.linkedinUrl },
          { $set: mapToLinkedinJob(raw, brand._id) },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        gulfJobsStored++;
      } catch (err) {
        if (err.code !== 11000) {
          logger.error(`Gulf job upsert error: ${err.message}`);
        } else {
          gulfJobsStored++;
        }
      }
    }
    logger.info(`Gulf jobs saved to database: ${gulfJobsStored}`);
  }

  if (!rawJobs.length) {
    logger.warn(
      isLinkedinGulfBrand(brand)
        ? `No jobs left after Gulf location filter (${locationFilter.dropped} dropped)`
        : isLinkedinStandardBrand(brand)
          ? `No jobs left after location filter (${locationFilter.dropped} dropped)`
          : domainFilter.dropped > 0
            ? `No jobs left after domain filter (${domainFilter.dropped} dropped)`
            : 'No jobs returned from actor'
    );
    return {
      companiesMatched: 0,
      contactsCreated: 0,
      jobsStored: gulfJobsStored,
      employeesFound: 0,
      rawJobs: apifyCount,
      jobsKept: 0,
      jobsFilteredOut: locationFilter.dropped,
      jobsCapDropped,
      gulfJobsStored,
      droppedJobs: 0
    };
  }

  const jobs = mapLinkedInJobsToContacts(rawJobs);
  logger.info(`Raw jobs: ${rawJobs.length} (max ${jobCap}) | Jobs mapped: ${jobs.length}`);

  // Build rawJobs lookup
  const rawJobsByUrl = {};
  for (const raw of rawJobs) {
    if (raw.linkedinUrl) rawJobsByUrl[raw.linkedinUrl] = raw;
  }

  // Collect company URLs
  let companyUrls = [...new Set(jobs.map(j => j.companyLinkedin).filter(Boolean))];
  if (opts.companyUrls?.length) {
    companyUrls = opts.companyUrls;
  }
  const employeeCompanyCap = isLinkedinGulfBrand(brand)
    ? companyUrls.length
    : Math.min(companyUrls.length, MAX_LINKEDIN_EMPLOYEE_COMPANIES_DEFAULT);

  logger.info(
    `Companies found: ${companyUrls.length}` +
    (employeeCompanyCap < companyUrls.length
      ? ` (employee lookup cap: ${employeeCompanyCap})`
      : '')
  );

  if (!companyUrls.length) {
    logger.warn('No companies found in job results');
    return {
      companiesMatched: 0,
      contactsCreated: 0,
      jobsStored: gulfJobsStored,
      employeesFound: 0,
      rawJobs: apifyCount,
      jobsKept: locationFilter.kept,
      jobsFilteredOut: locationFilter.dropped,
      jobsCapDropped,
      gulfJobsStored
    };
  }

  // STEP 2 — Employees
  const baseEmpInput = DEFAULT_EMPLOYEE_INPUT;
  const empInput = { ...baseEmpInput, ...(opts.employeeInput || {}) };

  // Check which companies already have cached HR emails in DB — using fuzzy matching
  const companySlice = companyUrls.slice(0, employeeCompanyCap);
  const cachedEmployeesByUrl = {};
  const companiesNeedingLookup = [];

  logger.info(
    `STEP 2 — Employee lookup for ${companySlice.length} company/companies` +
    (isLinkedinGulfBrand(brand) ? ' (all Gulf companies from filtered jobs)' : '')
  );

  for (const url of companySlice) {
    const normalized = normalizeLinkedinUrl(url);
    const job = jobs.find(j => normalizeLinkedinUrl(j.companyLinkedin || '') === normalized) || jobs.find(j => j.companyLinkedin === url) || {};
    const jobKey = buildCompanyKey({ companyLinkedin: url, companyName: job.companyName || '' });
    jobKey.linkedin = normalized;

    const { cached, matchedUrl } = await findCachedEmployeesForCompany(jobKey, brand._id);

    if (cached.length > 0) {
      // Store by the cached record's URL so STEP 3 fuzzy matching finds them
      const rep = cached[0];
      const cacheKey = rep.companyLinkedin ? normalizeLinkedinUrl(rep.companyLinkedin) : normalized;
      cachedEmployeesByUrl[cacheKey] = cached.map(c => ({
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
        country: c.country || ''
      }));
      logger.info(`Using ${cached.length} cached emails for ${normalized} via ${matchedUrl ? 'URL' : 'domain/brand'} (cacheKey=${cacheKey})`);
    } else {
      companiesNeedingLookup.push(url);
    }
  }

  let employees = [];

  if (companiesNeedingLookup.length > 0) {
    logger.info(`STEP 2 — Running LinkedIn Employees Actor for ${companiesNeedingLookup.length} new companies`);

    let rawEmpItems;
    try {
      rawEmpItems = await runActor(apiToken, LINKEDIN_EMPLOYEES_ACTOR, {
        ...empInput,
        companies: companiesNeedingLookup
      });
    } catch (err) {
      logger.error(`Employees actor failed: ${err.message}`);
      return {
        companiesMatched: 0,
        contactsCreated: 0,
        jobsStored: gulfJobsStored,
        employeesFound: 0,
        rawJobs: apifyCount,
        jobsKept: locationFilter.kept,
        jobsFilteredOut: locationFilter.dropped,
        jobsCapDropped
      };
    }

    const newEmployees = mapEmployeesToContacts(rawEmpItems);
    logger.info(`New employees with emails: ${newEmployees.length}`);

    // Index new employees by company URL
    for (const emp of newEmployees) {
      if (!emp.companyLinkedin) continue;
      const url = normalizeLinkedinUrl(emp.companyLinkedin);
      if (!cachedEmployeesByUrl[url]) {
        employees.push(emp);
      }
    }
  }

  // Merge cached employees into the employees array
  for (const emps of Object.values(cachedEmployeesByUrl)) {
    employees.push(...emps);
  }

  logger.info(`Total employees (cached + fresh): ${employees.length}`);

  if (!employees.length) {
    logger.warn('No employees with emails found — stopping');
    return {
      companiesMatched: 0,
      contactsCreated: 0,
      jobsStored: gulfJobsStored,
      employeesFound: 0,
      rawJobs: apifyCount,
      jobsKept: locationFilter.kept,
      jobsFilteredOut: locationFilter.dropped,
      jobsCapDropped
    };
  }

  // STEP 3 — Match + Store
  logger.info('STEP 3 — Matching companies and storing contacts');

  // Group employees by normalized company LinkedIn URL
  const employeesByUrl = {};
  for (const emp of employees) {
    if (!emp.companyLinkedin) continue;
    const url = normalizeLinkedinUrl(emp.companyLinkedin);
    if (!employeesByUrl[url]) employeesByUrl[url] = [];
    employeesByUrl[url].push(emp);
  }

  // Group jobs by normalized company LinkedIn URL
  const jobsByCompany = {};
  for (const job of jobs) {
    if (!job.companyLinkedin) continue;
    const url = normalizeLinkedinUrl(job.companyLinkedin);
    if (!jobsByCompany[url]) jobsByCompany[url] = [];
    jobsByCompany[url].push(job);
  }

  let companiesMatched = 0;
  let contactsCreated = 0;
  let jobsStored = 0;

  for (const [companyUrl, companyJobs] of Object.entries(jobsByCompany)) {
    const jobKey = buildCompanyKey({ companyLinkedin: companyUrl, companyName: companyJobs[0]?.companyName });
    const matchedEmpUrl = findMatchingCompanyUrl(jobKey, employeesByUrl);
    const companyEmployees = matchedEmpUrl ? employeesByUrl[matchedEmpUrl] : [];

    if (!matchedEmpUrl || companyEmployees.length === 0) {
      continue;
    }

    companiesMatched++;

    // Build LinkedContact map first (before creating contacts)
    const empToLcId = {};
    const allJobIds = [];

    // Save all jobs and collect IDs
    for (const job of companyJobs) {
      const rawJob = rawJobsByUrl[job.linkedinUrl];
      if (!rawJob) continue;

      let savedJob;
      try {
        savedJob = await LinkedinJob.findOneAndUpdate(
          { brandId: brand._id, linkedinUrl: job.linkedinUrl },
          { $set: mapToLinkedinJob(rawJob, brand._id) },
          { upsert: true, new: true }
        );
        jobsStored++;
        allJobIds.push(savedJob._id);
      } catch (err) {
        const existing = await LinkedinJob.findOne({ brandId: brand._id, linkedinUrl: job.linkedinUrl });
        if (existing) { allJobIds.push(existing._id); jobsStored++; }
        else logger.error(`Job upsert error: ${err.message}`);
      }
    }

    // Create/update LinkedinContact for each employee
    for (const emp of companyEmployees) {
      let existingLc = await LinkedinContact.findOne({ brandId: brand._id, email: emp.email });

      if (existingLc) {
        const existingIds = new Set(existingLc.linkedinJobIds.map(id => id.toString()));
        for (const jid of allJobIds) existingIds.add(jid);
        existingLc.linkedinJobIds = [...existingIds];
        existingLc.companyName = emp.companyName || existingLc.companyName;
        await existingLc.save();
        empToLcId[emp.email] = existingLc._id;
      } else {
        const lc = await LinkedinContact.create({
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
          linkedinJobIds: allJobIds,
          status: 'Pending'
        });
        empToLcId[emp.email] = lc._id;
      }
    }

    // Cartesian product: one Contact per (job × employee email)
    for (const job of companyJobs) {
      const rawJob = rawJobsByUrl[job.linkedinUrl];
      if (!rawJob) continue;

      const savedJob = await LinkedinJob.findOne({ brandId: brand._id, linkedinUrl: job.linkedinUrl });
      if (!savedJob) continue;

      for (const emp of companyEmployees) {
        const { created } = await upsertEnrichedContact(brand._id, {
          email: emp.email,
          firstName: emp.firstName || '',
          lastName: emp.lastName || '',
          fullName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
          jobTitle: job.jobTitle,
          linkedinUrl: emp.linkedinUrl || '',
          jobLinkedinUrl: job.linkedinUrl || '',
          companyName: job.companyName || '',
          companyLinkedin: companyUrl || '',
          industry: emp.industry || '',
          companySize: emp.companySize || '',
          companyWebsite: emp.companyWebsite || '',
          city: emp.city || '',
          state: emp.state || '',
          country: emp.country || '',
          status: 'Pending',
          importSource: 'linkedin-enriched',
          linkedinJobIds: [savedJob._id],
          linkedinContactId: empToLcId[emp.email]
        });
        if (created) contactsCreated++;
      }
    }
  }

  logger.info(`Results: ${companiesMatched} companies matched, ${contactsCreated} contacts created, ${jobsStored} jobs stored`);

  const totalJobsStored = isLinkedinGulfBrand(brand)
    ? Math.max(gulfJobsStored, jobsStored)
    : jobsStored;

  return {
    companiesMatched,
    contactsCreated,
    jobsStored: totalJobsStored,
    employeesFound: employees.length,
    rawJobs: apifyCount,
    jobsKept: locationFilter.kept,
    jobsFilteredOut: locationFilter.dropped,
    jobsCapDropped,
    gulfJobsStored,
    droppedJobs: apifyCount - totalJobsStored
  };
}

module.exports = scrapeLinkedInPhase;
