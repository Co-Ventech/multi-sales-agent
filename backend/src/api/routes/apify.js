/**
 * Apify routes for actor IoSHqwTR9YGhzccez
 *
 * Two-step flow:
 *   POST /run    — run actor, qualify leads, return ALL for preview (no DB write)
 *   POST /import — take contacts array from preview, write to DB with dedup
 *
 * Config:
 *   GET  /config — get saved Apify config (token masked)
 *   PUT  /config — save token, actorId, default input preset
 */

const express  = require('express');
const Brand    = require('../../models/Brand');
const Contact  = require('../../models/Contact');
const LinkedinJob = require('../../models/LinkedinJob');
const LinkedinContact = require('../../models/LinkedinContact');
const UpworkJob = require('../../models/UpworkJob');
const { requireAuth }    = require('../middleware/auth');
const asyncHandler       = require('../middleware/asyncHandler');
const { runActor, mapToContacts, mapLinkedInJobsToContacts, mapEmployeesToContacts, mapToLinkedinJob } = require('../../services/apifyService');
const { LeadQualifier }  = require('../../services/qualifierService');
const { buildApifyLeadsInputForBrand } = require('../../config/apifyLeadsFilters');
const {
  filterLinkedInJobsForBrand,
  shouldFilterLinkedinJobsByLocation
} = require('../../config/apifyLinkedinLocationFilters');
const {
  isLinkedinGulfBrand,
  buildLinkedinGulfMongoOr
} = require('../../config/apifyLinkedinGulfFilters');
const { filterJobsForDomain } = require('../../config/apifyJobDomainFilters');
const {
  getApifyToken,
  capJobScrapeInput,
  capUpworkScraperInput,
  capUpworkPipelineInput,
  buildLinkedInJobsActorInput,
  applyUpworkJobLocations,
  DEFAULT_LINKEDIN_JOB_LOCATIONS,
  MAX_JOB_SCRAPE_ITEMS,
  MAX_UPWORK_SCRAPER_ITEMS
} = require('../../config/apify');
const {
  filterUpworkJobsForBrand,
  shouldFilterUpworkByLocation,
  getUpworkAllowedLocations,
  buildClientLocationMongoOr
} = require('../../config/apifyUpworkLocationFilters');
const { generateCoverLetter } = require('../../services/deepseekService');
const { extractNativeJobId, enrichJobsWithMCP } = require('../../services/upworkEnrichment');
const { generateUpworkCoverLetter } = require('../../services/upworkCoverLetterService');
const { searchUpworkJobsViaMCP } = require('../../services/upworkMCPJobsService');
const { scoreProfilesForJob, scoreJobs } = require('../../services/profileScoringService');
const CandidateProfile = require('../../models/CandidateProfile');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// ── GET /config ───────────────────────────────────────────────────────────────
router.get('/config', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const cfg = brand.apify?.toObject?.() || brand.apify || {};
  return res.json({
    actorId:      cfg.actorId     || 'IoSHqwTR9YGhzccez',
    hasToken:     !!(cfg.apiToken),
    defaultInput: await buildApifyLeadsInputForBrand(brand)
  });
}));

// ── PUT /config ───────────────────────────────────────────────────────────────
router.put('/config', asyncHandler(async (req, res) => {
  const { apiToken, actorId, defaultInput } = req.body;

  const update = {};
  if (apiToken && apiToken !== '••••••••') update['apify.apiToken'] = apiToken;
  if (actorId)            update['apify.actorId']     = actorId;
  if (defaultInput != null) update['apify.defaultInput'] = defaultInput;

  const brand = await Brand.findByIdAndUpdate(req.params.brandId, { $set: update }, { new: true });
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  return res.json({
    actorId:      brand.apify?.actorId,
    hasToken:     !!(brand.apify?.apiToken),
    defaultInput: await buildApifyLeadsInputForBrand(brand)
  });
}));

// ── POST /run ─────────────────────────────────────────────────────────────────
// Runs actor, maps + qualifies all results, returns them for UI preview.
// NO database writes — user reviews and chooses what to import.
router.post('/run', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const rawInput = req.body.input;
  if (!rawInput || typeof rawInput !== 'object') {
    return res.status(400).json({ error: 'input object is required' });
  }

  const input = await buildApifyLeadsInputForBrand(brand, { requestOverrides: rawInput });

  const apiToken = getApifyToken(brand, req.body.apiToken);
  if (!apiToken) {
    return res.status(400).json({
      error: 'No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env (recommended).'
    });
  }

  const actorId = brand.apify?.actorId || process.env.APIFY_ACTOR_ID || 'IoSHqwTR9YGhzccez';

  console.log(
    `[Apify] /run actor=${actorId} fetch_count=${input.fetch_count} ` +
    `fields=${Object.keys(input).length} brand=${brand.name}`
  );

  // Run actor
  let rawItems;
  try {
    rawItems = await runActor(apiToken, actorId, input);
  } catch (err) {
    return res.status(500).json({ error: `Actor failed: ${err.message}` });
  }

  if (!rawItems.length) {
    return res.json({ scraped: 0, qualified: 0, contacts: [], message: 'Actor returned no results' });
  }

  // Map raw output → contact schema fields
  const mapped = mapToContacts(rawItems);

  // Qualify leads against brand threshold
  const qualifier = new LeadQualifier(
    { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    brand.qualification?.threshold ?? 6
  );
  const { qualified } = qualifier.qualifyBatch(mapped);

  // Mark which contacts already exist in this brand
  const emails = qualified.map(c => c.email);
  const existing = await Contact.find({ brandId: brand._id, email: { $in: emails } }).select('email');
  const existingSet = new Set(existing.map(c => c.email));

  const contacts = qualified.map(c => ({
    ...c,
    _exists: existingSet.has(c.email)   // flag for UI — grey out duplicates
  }));

  console.log(`[Apify] /run complete: ${rawItems.length} scraped → ${qualified.length} qualified (${existingSet.size} already in DB)`);

  return res.json({
    scraped:   rawItems.length,
    qualified: qualified.length,
    existing:  existingSet.size,
    contacts                           // full list, no truncation
  });
}));

// ── POST /import ──────────────────────────────────────────────────────────────
// Takes contacts array from the /run preview and writes new ones to DB.
// Frontend sends only the contacts the user selected.
router.post('/import', asyncHandler(async (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts array is required' });
  }

  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  // Strip the UI-only _exists flag and add brandId + status
  const docs = contacts
    .filter(c => c.email && c.email.includes('@'))
    .map(({ _exists, ...c }) => ({
      ...c,
      brandId: brand._id,
      status:  'Pending',
      importSource: c.importSource || 'apify'
    }));

  if (!docs.length) {
    return res.json({ imported: 0, duplicatesSkipped: 0 });
  }

  // Dedup check
  const emails = docs.map(d => d.email);
  const existing = await Contact.find({ brandId: brand._id, email: { $in: emails } }).select('email');
  const existingSet = new Set(existing.map(c => c.email));
  const toAdd = docs.filter(d => !existingSet.has(d.email));

  if (!toAdd.length) {
    return res.json({ imported: 0, duplicatesSkipped: docs.length, message: 'All contacts already exist' });
  }

  let inserted = 0;
  try {
    const result = await Contact.insertMany(toAdd, { ordered: false });
    inserted = result.length;
  } catch (err) {
    if (err.code === 11000) {
      inserted = err.result?.nInserted || 0;
    } else {
      throw err;
    }
  }

  console.log(`[Apify] /import: ${inserted} contacts added to brand ${brand.name}`);

  return res.json({
    imported:          inserted,
    duplicatesSkipped: docs.length - toAdd.length + (toAdd.length - inserted)
  });
}));

// ── LINKEDIN JOBS ROUTES ───────────────────────────────────────────────────────

const LINKEDIN_JOBS_ACTOR = 'zn01OAlzP853oqn4Z';
const LINKEDIN_EMPLOYEES_ACTOR = 'Vb6LZkh4EqRlR0Ka9';
const UPWORK_JOBS_ACTOR = 'XYTgO05GT5qAoSlxy';

const DEFAULT_UPWORK_JOBS_INPUT = {
  sort: 'newest',
  per_page: MAX_UPWORK_SCRAPER_ITEMS
};

const LINKEDIN_JOBS_DEFAULT_INPUT = {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

// Normalize a company LinkedIn URL to base form (strip trailing slash, /company/)
function normalizeLinkedinUrl(url) {
  if (!url) return '';
  return url.replace(/\/$/, '').replace(/\/company\//i, '/company/');
}

/** Resolve LinkedIn jobs for a Contact using every available link (IDs, URL, LinkedinContact, company). */
async function resolveLinkedinJobsForContact(brandId, contact) {
  if (contact.linkedinJobIds?.length) {
    const jobs = await LinkedinJob.find({ brandId, _id: { $in: contact.linkedinJobIds } });
    if (jobs.length) return jobs;
  }

  if (contact.jobLinkedinUrl) {
    const jobs = await LinkedinJob.find({ brandId, linkedinUrl: contact.jobLinkedinUrl });
    if (jobs.length) return jobs;
  }

  if (contact.linkedinContactId) {
    const lc = await LinkedinContact.findOne({ brandId, _id: contact.linkedinContactId }).select('linkedinJobIds');
    if (lc?.linkedinJobIds?.length) {
      const jobs = await LinkedinJob.find({ brandId, _id: { $in: lc.linkedinJobIds } });
      if (jobs.length) return jobs;
    }
  }

  if (contact.companyLinkedin) {
    const norm = normalizeLinkedinUrl(contact.companyLinkedin);
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      const jobs = await LinkedinJob.find({
        brandId,
        'company.linkedinUrl': { $regex: escaped, $options: 'i' }
      }).sort({ postedDate: -1 }).limit(10);
      if (jobs.length) return jobs;
    }
  }

  return [];
}

// Extract root brand name from company name (first significant word)
// "Hanwha Energy USA" → "hanwha"
// "Google LLC" → "google"
function extractRootBrand(name) {
  if (!name) return '';
  return name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
}

// Extract domain from company website URL
// "https://www.hanwharenewables.com" → "hanwharenewables.com"
function extractDomain(website) {
  if (!website) return '';
  try {
    const u = new URL(website);
    return u.hostname.replace(/^www\./, '');
  } catch {
    // Not a valid URL, try as-is
    return website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  }
}

// Build a normalized company key from an object that may have companyWebsite,
// companyName, and/or companyLinkedin fields. Used to match jobs to employees
// when exact LinkedIn URL differs but they share same parent company.
function buildCompanyKey(obj) {
  return {
    linkedin: normalizeLinkedinUrl(obj.companyLinkedin),
    rootBrand: extractRootBrand(obj.companyName),
    domain: extractDomain(obj.companyWebsite)
  };
}

// Find the best company URL match for a given job against the employees map.
// Returns the matched employee company URL if any key overlaps, otherwise null.
function findMatchingCompanyUrl(jobKey, employeesByUrl) {
  // 1. Exact LinkedIn URL match
  if (jobKey.linkedin && employeesByUrl[jobKey.linkedin]) {
    return jobKey.linkedin;
  }

  // 2. Domain overlap (company websites from same parent company)
  if (jobKey.domain) {
    for (const [empUrl, employees] of Object.entries(employeesByUrl)) {
      // Check if employee has same domain
      const empKey = employees[0] ? buildCompanyKey(employees[0]) : {};
      if (empKey.domain && (empKey.domain === jobKey.domain || empKey.domain.endsWith('.' + jobKey.domain) || jobKey.domain.endsWith('.' + empKey.domain))) {
        return empUrl;
      }
    }
  }

  // 3. Root brand match (both contain same brand name like "Hanwha")
  if (jobKey.rootBrand && jobKey.rootBrand.length >= 4) {
    for (const [empUrl, employees] of Object.entries(employeesByUrl)) {
      const empKey = employees[0] ? buildCompanyKey(employees[0]) : {};
      if (empKey.rootBrand && empKey.rootBrand === jobKey.rootBrand) {
        return empUrl;
      }
    }
  }

  return null;
}

// GET /config-jobs — get saved config for LinkedIn Jobs actor
router.get('/config-jobs', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId).select('apify');
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const cfg = brand.apify?.toObject?.() || brand.apify || {};
  return res.json({
    actorId:  cfg.linkedinJobsActorId || LINKEDIN_JOBS_ACTOR,
    hasToken: !!(cfg.apiToken),
    defaultInput: cfg.linkedinJobsDefaultInput || {}
  });
}));

// PUT /config-jobs — save token and default input for LinkedIn Jobs
router.put('/config-jobs', asyncHandler(async (req, res) => {
  const { apiToken, defaultInput } = req.body;

  const update = {};
  if (apiToken && apiToken !== '••••••••') update['apify.apiToken'] = apiToken;
  if (defaultInput != null) update['apify.linkedinJobsDefaultInput'] = defaultInput;

  const brand = await Brand.findByIdAndUpdate(req.params.brandId, { $set: update }, { new: true });
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  return res.json({
    actorId:  LINKEDIN_JOBS_ACTOR,
    hasToken: !!(brand.apify?.apiToken),
    defaultInput: brand.apify?.linkedinJobsDefaultInput || {}
  });
}));

// POST /run-jobs — run LinkedIn Jobs actor, return results for preview (no DB write)
// Uses saved defaults from brand.apify.linkedinJobsDefaultInput if no input provided
router.post('/run-jobs', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const apiToken = getApifyToken(brand, req.body.apiToken);
  if (!apiToken) {
    return res.status(400).json({
      error: 'No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env (recommended).'
    });
  }

  const saved = brand.apify?.linkedinJobsDefaultInput || {};
  const input = buildLinkedInJobsActorInput({
    ...LINKEDIN_JOBS_DEFAULT_INPUT,
    ...saved,
    ...(req.body.input || {})
  });
  const meta = input._scrapeMeta || {};
  delete input._scrapeMeta;

  if (!input.jobTitles || !input.jobTitles.length) {
    return res.status(400).json({ error: 'jobTitles is required. Provide in request body or save defaults in brand settings.' });
  }

  console.log(
    `[Apify] /run-jobs actor=${LINKEDIN_JOBS_ACTOR} titles=${meta.titlesUsed} locations=${meta.locationsUsed} ` +
    `(${meta.locations?.join(', ')}) maxItems=${input.maxItems}/query (~${meta.maxTotal} total) brand=${brand.name}`
  );

  const actorInput = { ...input, searchQueries: input.jobTitles };
  delete actorInput.jobTitles;

  let rawItems;
  try {
    rawItems = await runActor(apiToken, LINKEDIN_JOBS_ACTOR, actorInput);
  } catch (err) {
    return res.status(500).json({ error: `Actor failed: ${err.message}` });
  }

  const apifyCount = Array.isArray(rawItems) ? rawItems.length : 0;
  const jobCap = meta.maxTotal || MAX_JOB_SCRAPE_ITEMS;

  const locationFilter = filterLinkedInJobsForBrand(rawItems, brand);
  if (shouldFilterLinkedinJobsByLocation(brand) && locationFilter.dropped > 0) {
    console.log(
      `[Apify] /run-jobs location filter: kept ${locationFilter.kept}/${apifyCount} ` +
      `(${locationFilter.dropped} dropped) brand=${brand.name}`
    );
  }
  const domainFilter = filterJobsForDomain(locationFilter.items, brand, { titleStrict: true });
  if (domainFilter.dropped > 0) {
    console.log(
      `[Apify] /run-jobs domain filter: kept ${domainFilter.kept}/${domainFilter.kept + domainFilter.dropped} ` +
      `(${domainFilter.dropped} dropped — not in target domains) brand=${brand.name}`
    );
  }
  rawItems = domainFilter.items.slice(0, jobCap);

  if (!rawItems.length) {
    return res.json({
      scraped: 0,
      contacts: [],
      filteredOut: locationFilter.dropped + domainFilter.dropped,
      message: (locationFilter.dropped || domainFilter.dropped)
        ? 'Actor returned jobs but none matched location/domain filters'
        : 'Actor returned no results'
    });
  }

  // Map job postings → contact schema (with dummy emails)
  const contacts = mapLinkedInJobsToContacts(rawItems);

  // Map raw items to LinkedinJob schema (full job data for storage)
  const linkedinJobs = rawItems.map(item => mapToLinkedinJob(item, brand._id));

  // Check which are already in DB (by dummy email)
  const emails = contacts.map(c => c.email);
  const existing = await Contact.find({ brandId: brand._id, email: { $in: emails } }).select('email');
  const existingSet = new Set(existing.map(c => c.email));

  // Also check which linkedinUrls are already stored as LinkedinJob
  const linkedinUrls = linkedinJobs.map(j => j.linkedinUrl).filter(Boolean);
  const existingJobs = await LinkedinJob.find({ brandId: brand._id, linkedinUrl: { $in: linkedinUrls } }).select('linkedinUrl');
  const existingJobsSet = new Set(existingJobs.map(j => j.linkedinUrl));

  const contactsWithFlag = contacts.map((c, idx) => ({
    ...c,
    _exists: existingSet.has(c.email),
    _jobExists: existingJobsSet.has(linkedinJobs[idx].linkedinUrl)
  }));

  console.log(`[Apify] /run-jobs complete: ${rawItems.length} scraped → ${contacts.length} mapped (${existingSet.size} already in DB)`);

  return res.json({
    scraped:  apifyCount,
    qualified: contacts.length,
    existing:  existingSet.size,
    filteredOut: locationFilter.dropped + domainFilter.dropped,
    domainFilteredOut: domainFilter.dropped,
    jobsKept: locationFilter.kept,
    contacts:  contactsWithFlag,
    rawJobs:   rawItems   // full raw job data for storage via /import-enriched-jobs
  });
}));

// POST /import-jobs — import selected job postings to DB
router.post('/import-jobs', asyncHandler(async (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts array is required' });
  }

  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const docs = contacts
    .filter(c => c.email && c.email.includes('@'))
    .map(({ _exists, ...c }) => ({
      ...c,
      brandId: brand._id,
      status:  'Pending',
      importSource: 'linkedin-jobs'
    }));

  if (!docs.length) {
    return res.json({ imported: 0, duplicatesSkipped: 0 });
  }

  const emails = docs.map(d => d.email);
  const existing = await Contact.find({ brandId: brand._id, email: { $in: emails } }).select('email');
  const existingSet = new Set(existing.map(c => c.email));
  const toAdd = docs.filter(d => !existingSet.has(d.email));

  if (!toAdd.length) {
    return res.json({ imported: 0, duplicatesSkipped: docs.length, message: 'All contacts already exist' });
  }

  let inserted = 0;
  try {
    const result = await Contact.insertMany(toAdd, { ordered: false });
    inserted = result.length;
  } catch (err) {
    if (err.code === 11000) {
      inserted = err.result?.nInserted || 0;
    } else {
      throw err;
    }
  }

  console.log(`[Apify] /import-jobs: ${inserted} job postings added to brand ${brand.name}`);

  return res.json({
    imported:          inserted,
    duplicatesSkipped:  docs.length - toAdd.length + (toAdd.length - inserted)
  });
}));

// ── LINKEDIN EMPLOYEES ROUTES ────────────────────────────────────────────────

// POST /run-employees — run LinkedIn Company Employees actor to find emails at companies
// Accepts companyUrls array from request body (from /run-jobs preview).
// Falls back to auto-collecting from DB if not provided.
router.post('/run-employees', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const apiToken = getApifyToken(brand, req.body.apiToken);
  if (!apiToken) {
    return res.status(400).json({
      error: 'No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env (recommended).'
    });
  }

  // Use provided companyUrls, or fall back to auto-collect from DB
  let companyUrls = req.body.companyUrls;

  if (!companyUrls || !companyUrls.length) {
    // Auto-collect from existing job contacts in DB
    const jobContacts = await Contact.find({
      brandId: brand._id,
      importSource: 'linkedin-jobs',
      companyLinkedin: { $exists: true, $ne: '' }
    }).select('companyLinkedin');
    companyUrls = [...new Set(jobContacts.map(c => c.companyLinkedin).filter(Boolean))];
  }

  if (companyUrls.length === 0) {
    return res.json({ scraped: 0, contacts: [], message: 'No job contacts with company LinkedIn URLs found. Run /run-jobs first.' });
  }

  console.log(`[Apify] /run-employees actor=${LINKEDIN_EMPLOYEES_ACTOR} companies=${companyUrls.length} brand=${brand.name}`);

  // Actor input with email search enabled
  const actorInput = {
    companies: companyUrls,
    functionIds: ['12'],  // HR function ID to target HR contacts
    profileScraperMode: 'Full + email search ($12 per 1k)',  // paid mode that finds emails
    recentlyChangedJobs: false,
    maxItems: 50  // reasonable limit per run
  };

  let rawItems;
  try {
    rawItems = await runActor(apiToken, LINKEDIN_EMPLOYEES_ACTOR, actorInput);
  } catch (err) {
    return res.status(500).json({ error: `Actor failed: ${err.message}` });
  }

  if (!rawItems.length) {
    return res.json({ scraped: 0, contacts: [], message: 'Actor returned no results' });
  }

  // Map employee data → contact schema
  const contacts = mapEmployeesToContacts(rawItems);

  console.log(`[Apify] /run-employees complete: ${rawItems.length} scraped → ${contacts.length} with valid emails`);

  return res.json({
    scraped:  rawItems.length,
    qualified: contacts.length,
    contacts:  contacts
  });
}));

// POST /import-employees — import selected employees to DB
// Groups employees by companyLinkedin URL, finds ALL job contacts for each company,
// and updates ALL of them with real emails found (spreads employees across all jobs).
// Employees with no matching job contact are inserted as standalone contacts.
router.post('/import-employees', asyncHandler(async (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'contacts array is required' });
  }

  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const validContacts = contacts.filter(c => c.email && c.email.includes('@'));

  if (!validContacts.length) {
    return res.json({ imported: 0, updated: 0, matched: 0 });
  }

  // Group employees by normalized company LinkedIn URL
  const byCompany = {};
  for (const emp of validContacts) {
    if (!emp.companyLinkedin) continue;
    const url = emp.companyLinkedin.replace(/\/$/, '');
    if (!byCompany[url]) byCompany[url] = [];
    byCompany[url].push(emp);
  }

  let matched = 0;  // total job contacts updated with real emails
  let inserted = 0; // new standalone contacts inserted

  for (const [companyUrl, employees] of Object.entries(byCompany)) {
    // Find ALL job contacts for this company URL
    const jobContacts = await Contact.find({
      brandId: brand._id,
      importSource: 'linkedin-jobs',
      $or: [
        { companyLinkedin: companyUrl },
        { companyLinkedin: companyUrl + '/' }
      ]
    }).select('_id email companyLinkedin');

    if (jobContacts.length > 0) {
      // Assign each employee to a distinct job contact (1:1 mapping, no reuse)
      // Extra job contacts (more jobs than employees) keep their dummy emails
      const assignCount = Math.min(jobContacts.length, employees.length);
      for (let i = 0; i < assignCount; i++) {
        const emp = employees[i];
        await Contact.findByIdAndUpdate(jobContacts[i]._id, {
          $set: {
            email: emp.email,
            firstName: emp.firstName,
            lastName: emp.lastName,
            fullName: emp.fullName,
            jobTitle: emp.jobTitle || jobContacts[i].jobTitle,
            linkedinUrl: emp.linkedinUrl || jobContacts[i].linkedinUrl,
            importSource: 'linkedin-employees-enriched'
          }
        });
        matched++;
      }
    } else {
      // No matching job contact for this company — insert each employee as standalone
      for (const emp of employees) {
        const existingEmail = await Contact.findOne({
          brandId: brand._id,
          email: emp.email
        }).select('_id');

        if (!existingEmail) {
          await Contact.create({
            ...emp,
            brandId: brand._id,
            status: 'Pending',
            importSource: 'linkedin-employees'
          });
          inserted++;
        }
      }
    }
  }

  console.log(`[Apify] /import-employees: ${matched} job contacts enriched, ${inserted} new employees added for brand ${brand.name}`);

  return res.json({
    imported: inserted,
    updated: matched,
    matched: matched
  });
}));

// POST /import-enriched-jobs — takes jobs from /run-jobs preview and employees from
// /run-employees, matches by companyLinkedin URL.
  // For each company that has at least one employee with email:
  //   - ALL jobs for that company are stored as LinkedinJob
  //   - One LinkedinContact per employee, with ALL job IDs linked
  // Companies with no employees found → all their jobs are dropped.
  router.post('/import-enriched-jobs', asyncHandler(async (req, res) => {
    const { jobs, employees, rawJobs } = req.body;

    if (!Array.isArray(jobs) || !jobs.length) {
      return res.status(400).json({ error: 'jobs array is required' });
    }
    if (!Array.isArray(employees) || !employees.length) {
      return res.status(400).json({ error: 'employees array is required' });
    }
    if (!Array.isArray(rawJobs) || !rawJobs.length) {
      return res.status(400).json({ error: 'rawJobs array is required (pass raw job items from /run-jobs response)' });
    }

    const brand = await Brand.findById(req.params.brandId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const locationFilter = filterLinkedInJobsForBrand(rawJobs, brand);
    const domainFilter = filterJobsForDomain(locationFilter.items, brand, { titleStrict: true });
    const filteredRawJobs = domainFilter.items;
    if (shouldFilterLinkedinJobsByLocation(brand) && locationFilter.dropped > 0) {
      console.log(
        `[Apify] /import-enriched-jobs location filter: kept ${locationFilter.kept}, dropped ${locationFilter.dropped}`
      );
    }
    if (domainFilter.dropped > 0) {
      console.log(
        `[Apify] /import-enriched-jobs domain filter: kept ${domainFilter.kept}, dropped ${domainFilter.dropped}`
      );
    }
    const filteredJobUrls = new Set(filteredRawJobs.map((r) => r.linkedinUrl).filter(Boolean));

    const validEmployees = employees.filter(e => e.email && e.email.includes('@'));

    // Group employees by normalized company LinkedIn URL
    const employeesByUrl = {};
    for (const emp of validEmployees) {
      if (!emp.companyLinkedin) continue;
      const url = normalizeLinkedinUrl(emp.companyLinkedin);
      if (!employeesByUrl[url]) employeesByUrl[url] = [];
      employeesByUrl[url].push(emp);
    }

    // Group jobs by normalized company LinkedIn URL (Gulf: only jobs that passed location filter)
    const jobsByCompany = {};
    for (const job of jobs) {
      if (!job.companyLinkedin) continue;
      if (shouldFilterLinkedinJobsByLocation(brand) && job.linkedinUrl && !filteredJobUrls.has(job.linkedinUrl)) {
        continue;
      }
      const url = normalizeLinkedinUrl(job.companyLinkedin);
      if (!jobsByCompany[url]) jobsByCompany[url] = [];
      jobsByCompany[url].push(job);
    }

    // Build rawJobs lookup by linkedinUrl
    const rawJobsByUrl = {};
    for (const raw of filteredRawJobs) {
      if (raw.linkedinUrl) rawJobsByUrl[raw.linkedinUrl] = raw;
    }

    let companiesMatched = 0;
    let contactsCreated = 0;
    let jobsStored = 0;
    let contactsSkipped = 0;

    // Process each company: only if at least one employee was found
    for (const [companyUrl, companyJobs] of Object.entries(jobsByCompany)) {
      const jobKey = buildCompanyKey({ companyLinkedin: companyUrl, companyName: companyJobs[0]?.companyName, companyWebsite: companyJobs[0]?.companyWebsite });
      const matchedEmpUrl = findMatchingCompanyUrl(jobKey, employeesByUrl);
      const companyEmployees = matchedEmpUrl ? employeesByUrl[matchedEmpUrl] : [];

      // Skip companies with no employee found
      if (!matchedEmpUrl || companyEmployees.length === 0) continue;

      companiesMatched++;

      // Upsert all jobs for this company (no job dropped for this company)
      const jobIds = [];
      for (const job of companyJobs) {
        const rawJob = rawJobsByUrl[job.linkedinUrl];
        if (!rawJob) continue;

        const jobDoc = mapToLinkedinJob(rawJob, brand._id);

        // Try upsert (update if exists, insert if not)
        let saved;
        try {
          saved = await LinkedinJob.findOneAndUpdate(
            { brandId: brand._id, linkedinUrl: job.linkedinUrl },
            { $set: jobDoc },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          jobIds.push(saved._id);
          jobsStored++;
        } catch (err) {
          if (err.code === 11000) {
            // Already exists — fetch it
            const existing = await LinkedinJob.findOne({ brandId: brand._id, linkedinUrl: job.linkedinUrl });
            if (existing) jobIds.push(existing._id);
          } else {
            console.error('[Apify] LinkedinJob upsert error:', err.message);
          }
        }
      }

      // Create one LinkedinContact per employee (dedup by email)
      for (const emp of companyEmployees) {
        const existing = await LinkedinContact.findOne({ brandId: brand._id, email: emp.email });
        if (existing) {
          // Update linkedinJobIds to include all jobs at this company (add new ones)
          const existingJobIds = new Set(existing.linkedinJobIds.map(id => id.toString()));
          for (const jid of jobIds) existingJobIds.add(jid);
          existing.linkedinJobIds = [...existingJobIds];
          existing.companyName = emp.companyName || existing.companyName;
          existing.jobTitle = emp.jobTitle || existing.jobTitle;
          existing.linkedinUrl = emp.linkedinUrl || existing.linkedinUrl;
          existing.companyLinkedin = emp.companyLinkedin || existing.companyLinkedin;
          await existing.save();

          // Also upsert Contact record with all fields (upsert: true = insert if not exists, update if exists)
          await Contact.findOneAndUpdate(
            { brandId: brand._id, email: emp.email },
            { $set: {
              email: emp.email,
              firstName: emp.firstName || '',
              lastName: emp.lastName || '',
              fullName: emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
              jobTitle: emp.jobTitle || '',
              linkedinUrl: emp.linkedinUrl || '',
              companyName: emp.companyName || '',
              companyLinkedin: emp.companyLinkedin || '',
              industry: emp.industry || '',
              companySize: emp.companySize || '',
              companyWebsite: emp.companyWebsite || '',
              city: emp.city || '',
              state: emp.state || '',
              country: emp.country || '',
              status: 'Pending',
              importSource: 'linkedin-enriched',
              linkedinContactId: existing._id,
              linkedinJobIds: jobIds,
              jobLinkedinUrl: companyJobs[0]?.linkedinUrl || ''
            }},
            { upsert: true }
          );
          contactsSkipped++;
        } else {
          // Create LinkedinContact first
          const lc = await LinkedinContact.create({
            brandId: brand._id,
            email: emp.email,
            firstName: emp.firstName || '',
            lastName: emp.lastName || '',
            fullName: emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
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
            linkedinJobIds: jobIds,
            status: 'Pending'
          });

          // Also create Contact record for the email pipeline, linked to LinkedinContact
          await Contact.findOneAndUpdate(
            { brandId: brand._id, email: emp.email },
            { $setOnCreate: {
              email: emp.email,
              firstName: emp.firstName || '',
              lastName: emp.lastName || '',
              fullName: emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
              jobTitle: emp.jobTitle || '',
              linkedinUrl: emp.linkedinUrl || '',
              companyName: emp.companyName || '',
              companyLinkedin: emp.companyLinkedin || '',
              industry: emp.industry || '',
              companySize: emp.companySize || '',
              companyWebsite: emp.companyWebsite || '',
              city: emp.city || '',
              state: emp.state || '',
              country: emp.country || '',
              status: 'Pending',
              importSource: 'linkedin-enriched',
              linkedinContactId: lc._id,
              linkedinJobIds: jobIds,
              jobLinkedinUrl: companyJobs[0]?.linkedinUrl || ''
            }},
            { upsert: true }
          );
          contactsCreated++;
        }
      }
    }

    const totalJobsForMatched = Object.keys(jobsByCompany).filter(k => {
      const jobKey = buildCompanyKey({ companyLinkedin: k, companyName: jobsByCompany[k][0]?.companyName });
      return findMatchingCompanyUrl(jobKey, employeesByUrl);
    }).reduce((sum, k) => sum + jobsByCompany[k].length, 0);

    const dropped = jobs.length - jobsStored;

    console.log(`[Apify] /import-enriched-jobs: ${contactsCreated} contacts created, ${contactsSkipped} updated, ${jobsStored} jobs stored, ${companiesMatched} companies matched, ${dropped} jobs dropped`);

    return res.json({
      contactsCreated,
      contactsUpdated: contactsSkipped,
      linkedinJobsStored: jobsStored,
      companiesMatched,
      totalJobs: jobs.length,
      jobsDropped: dropped
    });
  }));

// GET /linkedin-jobs — get full LinkedInJob data for a LinkedInContact
// Accepts ?contactId=..., ?linkedinContactId=..., or ?linkedinUrls=... (legacy)
router.get('/linkedin-jobs', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const Contact = require('../../models/Contact');
  const { linkedinContactId, linkedinUrls, contactId } = req.query;

  let jobs = [];
  if (contactId) {
    const contact = await Contact.findOne({ brandId: brand._id, _id: contactId });
    if (!contact) return res.json({ jobs: [], contact: null });

    const jobs = await resolveLinkedinJobsForContact(brand._id, contact);

    let hrProfile = { linkedinUrl: contact.linkedinUrl || '' };
    if (contact.linkedinContactId) {
      const lc = await LinkedinContact.findOne({ brandId: brand._id, _id: contact.linkedinContactId });
      if (lc) {
        hrProfile = {
          _id: lc._id,
          email: lc.email,
          fullName: lc.fullName,
          companyName: lc.companyName,
          linkedinUrl: lc.linkedinUrl || contact.linkedinUrl || ''
        };
      }
    }
    return res.json({ jobs, contact: hrProfile });
  }

  if (linkedinContactId) {
    // Fetch all jobs linked to this contact
    const contact = await LinkedinContact.findOne({ brandId: brand._id, _id: linkedinContactId });
    if (!contact) return res.json({ jobs: [], contact: null });
    jobs = await LinkedinJob.find({ brandId: brand._id, _id: { $in: contact.linkedinJobIds } });
    return res.json({ jobs, contact: { _id: contact._id, email: contact.email, fullName: contact.fullName, companyName: contact.companyName, linkedinUrl: contact.linkedinUrl || '' } });
  }

  if (linkedinUrls) {
    const urls = linkedinUrls.split(',').filter(Boolean);
    jobs = await LinkedinJob.find({ brandId: brand._id, linkedinUrl: { $in: urls } });
    return res.json({ jobs });
  }

  return res.status(400).json({ error: 'contactId, linkedinContactId, or linkedinUrls query param required' });
}));

// GET /upwork-jobs — get full UpworkJob data for a contact
// Accepts ?contactId=... to load via the Contact's upworkJobIds, or ?upworkJobIds=...
router.get('/upwork-jobs', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const { contactId, upworkJobIds } = req.query;

  const UpworkJob = require('../../models/UpworkJob');

  if (contactId) {
    const contact = await Contact.findOne({ brandId: brand._id, _id: contactId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    if (!contact.upworkJobIds || contact.upworkJobIds.length === 0) {
      return res.json({ jobs: [] });
    }
    const jobs = await UpworkJob.find({ brandId: brand._id, _id: { $in: contact.upworkJobIds } });
    return res.json({ jobs });
  }

  if (upworkJobIds) {
    const ids = upworkJobIds.split(',').filter(Boolean);
    const jobs = await UpworkJob.find({ brandId: brand._id, _id: { $in: ids } });
    return res.json({ jobs });
  }

  return res.status(400).json({ error: 'contactId or upworkJobIds query param required' });
}));

async function storeLinkedinJobsFromRaw(brand, rawItems) {
  const brandId = brand._id || brand;
  const locationFilter = filterLinkedInJobsForBrand(rawItems, brand);
  const domainFilter = filterJobsForDomain(locationFilter.items, brand, { titleStrict: true });
  const jobsToStore = domainFilter.items;

  let stored = 0;
  const jobIds = [];
  for (const raw of jobsToStore) {
    const jobDoc = mapToLinkedinJob(raw, brandId);
    if (!jobDoc.linkedinUrl) continue;
    try {
      const doc = await LinkedinJob.findOneAndUpdate(
        { brandId, linkedinUrl: jobDoc.linkedinUrl },
        { $set: jobDoc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (doc && doc._id) jobIds.push(String(doc._id));
      stored++;
    } catch (err) {
      if (err.code === 11000) {
        const existing = await LinkedinJob.findOne({ brandId, linkedinUrl: jobDoc.linkedinUrl });
        if (existing) {
          jobIds.push(String(existing._id));
          stored++;
        }
      } else {
        console.error('[Apify] LinkedinJob upsert error:', err.message);
      }
    }
  }
  return { stored, jobIds, droppedByDomain: domainFilter.dropped, kept: domainFilter.kept };
}

async function storeUpworkJobsFromRaw(brand, rawJobs) {
  const brandId = brand._id || brand;
  const locationFilter = filterUpworkJobsForBrand(rawJobs, brand);
  const domainFilter = filterJobsForDomain(locationFilter.items, brand);
  const jobsToStore = domainFilter.items;

  // Read-only MCP enrichment. Never throws — empty Map on any failure so the
  // standard Apify scrape path continues unchanged.
  let enrichMap = new Map();
  try {
    enrichMap = await enrichJobsWithMCP(jobsToStore);
  } catch (err) {
    console.warn('[Upwork MCP] Enrichment failed, using Apify data only:', err.message);
    enrichMap = new Map();
  }

  let stored = 0;
  const jobIds = [];
  for (const raw of jobsToStore) {
    const jobId = extractNativeJobId(raw);
    if (!jobId) continue;
    const extra = enrichMap.get(jobId) || {};
    if (Object.keys(extra).length) {
      console.log(
        `[MCP Enrichment] Merging into Apify payload for Job ID: ${jobId} | ` +
        `skills=${(extra.skills || []).length} category=${extra.category || 'N/A'} jobStatus=${extra.jobStatus || 'N/A'}`
      );
    }
    try {
      const doc = await UpworkJob.findOneAndUpdate(
        { brandId, jobId },
        { $set: {
          brandId,
          jobId,
          url: raw.url || '',
          title: raw.title || '',
          description: raw.description || '',
          budget: extra.budget || raw.budget || null,
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
          status: 'new',
          // Additive MCP enrichment — only set when MCP returned a value.
          ...(Array.isArray(extra.skills) && extra.skills.length ? { skills: extra.skills } : {}),
          ...(extra.category ? { category: extra.category } : {}),
          ...(extra.subcategory ? { subcategory: extra.subcategory } : {}),
          ...(extra.jobStatus ? { jobStatus: extra.jobStatus } : {}),
          ...(extra.lastVerifiedAt ? { lastVerifiedAt: extra.lastVerifiedAt } : {}),
          // MCP-provider raws carry their own skills/category/subcategory; gated on
          // raw.source === 'mcp' so Apify raws are byte-for-byte unchanged.
          ...(raw.source === 'mcp' && Array.isArray(raw.skills) && raw.skills.length ? { skills: raw.skills } : {}),
          ...(raw.source === 'mcp' && raw.category ? { category: raw.category } : {}),
          ...(raw.source === 'mcp' && raw.subcategory ? { subcategory: raw.subcategory } : {}),
          ...(raw.source || extra.source ? { source: raw.source || extra.source } : {})
        }},
        { upsert: true, new: true }
      );
      if (doc && doc._id) jobIds.push(String(doc._id));
      stored++;
    } catch (err) {
      console.error('[Apify] UpworkJob upsert error:', err.message);
    }
  }
  return {
    stored,
    dropped: locationFilter.dropped,
    droppedByDomain: domainFilter.dropped,
    kept: locationFilter.kept,
    allowedLocations: locationFilter.allowedLocations,
    jobIds
  };
}

// POST /scrape-jobs/linkedin — run LinkedIn Jobs actor and store LinkedinJob records only
router.post('/scrape-jobs/linkedin', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const apiToken = getApifyToken(brand, req.body.apiToken);
  if (!apiToken) {
    return res.status(400).json({
      error: 'No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env (recommended).'
    });
  }

  const saved = brand.apify?.linkedinJobsDefaultInput || {};
  const input = buildLinkedInJobsActorInput({
    ...LINKEDIN_JOBS_DEFAULT_INPUT,
    ...saved,
    ...(req.body.input || {})
  });
  const meta = input._scrapeMeta || {};
  delete input._scrapeMeta;

  if (!input.jobTitles?.length) {
    return res.status(400).json({ error: 'jobTitles is required. Save LinkedIn job defaults in brand Apify settings.' });
  }

  console.log(
    `[Apify] /scrape-jobs/linkedin titles=${meta.titlesUsed} locations=${meta.locationsUsed} ` +
    `(${meta.locations?.join(', ')}) filters=${JSON.stringify({
      employmentType: input.employmentType,
      experienceLevel: input.experienceLevel,
      workplaceType: input.workplaceType,
      postedLimit: input.postedLimit,
      sortBy: input.sortBy,
      easyApply: input.easyApply,
      under10Applicants: input.under10Applicants
    })} maxItems=${input.maxItems}/query (~${meta.maxTotal} total) brand=${brand.name}`
  );

  const actorInput = { ...input, searchQueries: input.jobTitles };
  delete actorInput.jobTitles;

  let rawItems;
  try {
    rawItems = await runActor(apiToken, LINKEDIN_JOBS_ACTOR, actorInput);
  } catch (err) {
    return res.status(500).json({ error: `Actor failed: ${err.message}` });
  }

  const apifyCount = Array.isArray(rawItems) ? rawItems.length : 0;
  const jobCap = meta.maxTotal || MAX_JOB_SCRAPE_ITEMS;

  const locationFilter = filterLinkedInJobsForBrand(rawItems, brand);
  if (shouldFilterLinkedinJobsByLocation(brand) && locationFilter.dropped > 0) {
    console.log(
      `[Apify] /scrape-jobs/linkedin location filter: kept ${locationFilter.kept}/${apifyCount} ` +
      `(${locationFilter.dropped} dropped) brand=${brand.name}`
    );
  }
  const domainFilter = filterJobsForDomain(locationFilter.items, brand, { titleStrict: true });
  if (domainFilter.dropped > 0) {
    console.log(
      `[Apify] /scrape-jobs/linkedin domain filter: kept ${domainFilter.kept}/${domainFilter.kept + domainFilter.dropped} ` +
      `(${domainFilter.dropped} dropped — not in target domains) brand=${brand.name}`
    );
  }
  rawItems = domainFilter.items.slice(0, jobCap);

  if (!rawItems.length) {
    return res.json({
      scraped: 0,
      stored: 0,
      filteredOut: locationFilter.dropped + domainFilter.dropped,
      message: (locationFilter.dropped || domainFilter.dropped)
        ? 'Actor returned jobs but none matched location/domain filters'
        : 'Actor returned no results'
    });
  }

  const storedResult = await storeLinkedinJobsFromRaw(brand, rawItems);
  const stored = storedResult.stored;
  const domainDropped = (storedResult.droppedByDomain || 0) + domainFilter.dropped;
  console.log(
    `[Apify] /scrape-jobs/linkedin: ${rawItems.length} scraped → ${stored} stored (cap ${meta.maxTotal}) ` +
    `domainDropped ${domainDropped} brand=${brand.name}`
  );

  // Background profile scoring — never blocks or breaks the scrape response.
  if (Array.isArray(storedResult.jobIds) && storedResult.jobIds.length) {
    const jobIds = storedResult.jobIds;
    setImmediate(() => {
      scoreJobs(jobIds, LinkedinJob).catch((err) => {
        console.error('[PROFILE SCORING] Background scoring error:', err.message);
      });
    });
  }

  return res.json({
    scraped: apifyCount,
    stored,
    jobsKept: locationFilter.kept,
    filteredOut: locationFilter.dropped + domainDropped,
    domainFilteredOut: domainDropped,
    message: `Stored ${stored} LinkedIn job(s) in database`
  });
}));

// POST /scrape-jobs/upwork — run Upwork Jobs actor and store UpworkJob records only
router.post('/scrape-jobs/upwork', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const provider = req.body.provider || brand.apify?.provider || 'apify';

  if (provider === 'mcp') {
    console.log(`[Upwork MCP] Starting job scrape for brand: ${brand.name} (${brand._id})`);
    let mcpResult;
    try {
      mcpResult = await searchUpworkJobsViaMCP(brand, req.body.input || {});
    } catch (err) {
      console.error(`[Upwork MCP] Error during scrape: ${err.message}`);
      return res.status(500).json({ error: `MCP search failed: ${err.message}` });
    }

    console.log(`[Upwork MCP] Received ${mcpResult.items.length} filtered jobs from MCP service.`);
    const mappedJobs = mcpResult.items;
    if (!mappedJobs.length) {
      return res.json({
        scraped: 0,
        stored: 0,
        dropped: 0,
        kept: 0,
        apifyReturned: mcpResult.rawCount || 0,
        allowedLocations: [],
        message: 'No Upwork jobs posted in the last 24 hours were returned by MCP.'
      });
    }

    console.log(`[Upwork MCP] Upserting ${mappedJobs.length} jobs into MongoDB...`);
    const storeResult = await storeUpworkJobsFromRaw(brand, mappedJobs);
    const { stored, dropped, kept, allowedLocations } = storeResult;
    const domainDropped = storeResult.droppedByDomain || 0;
    console.log(`[Upwork MCP] Successfully scraped and stored ${stored} jobs.`);
    if (Array.isArray(storeResult.jobIds) && storeResult.jobIds.length) {
      const jobIds = storeResult.jobIds;
      setImmediate(() => {
        scoreJobs(jobIds, UpworkJob).catch((err) => {
          console.error('[PROFILE SCORING] Background scoring error:', err.message);
        });
      });
    }
    const locationNote = dropped > 0
      ? ` ${dropped} job(s) skipped (client location not in ${allowedLocations.join(', ')}).`
      : '';
    const domainNote = domainDropped > 0
      ? ` ${domainDropped} job(s) skipped (not in target tech domains).`
      : '';
    return res.json({
      scraped: mappedJobs.length,
      stored,
      dropped,
      droppedByDomain: domainDropped,
      kept,
      apifyReturned: mcpResult.rawCount || mappedJobs.length,
      allowedLocations,
      message: `Stored ${stored} Upwork job(s) from MCP (last 24h).${locationNote}${domainNote}`
    });
  }

  const apiToken = getApifyToken(brand, req.body.apiToken);
  if (!apiToken) {
    return res.status(400).json({
      error: 'No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env (recommended).'
    });
  }

  const actorInput = capUpworkScraperInput(
    applyUpworkJobLocations(
      {
        ...DEFAULT_UPWORK_JOBS_INPUT,
        ...(brand.apify?.defaultInput || {}),
        ...(req.body.input || {})
      },
      brand
    )
  );

  const locs = Array.isArray(actorInput.location) ? actorInput.location : [actorInput.location].filter(Boolean);
  console.log(
    `[Apify] /scrape-jobs/upwork per_page=${actorInput.per_page} (cap ${MAX_UPWORK_SCRAPER_ITEMS}) ` +
    `locations=${locs.length} (${locs.join(', ')}) brand=${brand.name}`
  );

  let rawItems;
  try {
    rawItems = await runActor(apiToken, UPWORK_JOBS_ACTOR, actorInput);
  } catch (err) {
    return res.status(500).json({ error: `Actor failed: ${err.message}` });
  }

  const apifyCount = Array.isArray(rawItems) ? rawItems.length : 0;
  const rawJobs = Array.isArray(rawItems) ? rawItems : [];
  if (!rawJobs.length) {
    return res.json({ scraped: 0, stored: 0, apifyReturned: apifyCount, message: 'Actor returned no results' });
  }

  const storeResult = await storeUpworkJobsFromRaw(brand, rawJobs);
  const { stored, dropped, kept, allowedLocations } = storeResult;
  const domainDropped = storeResult.droppedByDomain || 0;
  console.log(
    `[Apify] /scrape-jobs/upwork: Apify returned ${apifyCount}, kept ${kept} by location, ` +
    `stored ${stored}, dropped ${dropped} (allowed: ${allowedLocations.join(', ') || 'none'}) ` +
    `domainDropped ${domainDropped} brand=${brand.name}`
  );

  // Background profile scoring — never blocks or breaks the scrape response.
  if (Array.isArray(storeResult.jobIds) && storeResult.jobIds.length) {
    const jobIds = storeResult.jobIds;
    setImmediate(() => {
      scoreJobs(jobIds, UpworkJob).catch((err) => {
        console.error('[PROFILE SCORING] Background scoring error:', err.message);
      });
    });
  }

  const locationNote = dropped > 0
    ? ` ${dropped} job(s) skipped (client location not in ${allowedLocations.join(', ')}).`
    : '';
  const domainNote = domainDropped > 0
    ? ` ${domainDropped} job(s) skipped (not in target tech domains).`
    : '';

  return res.json({
    scraped: rawJobs.length,
    stored,
    dropped,
    droppedByDomain: domainDropped,
    kept,
    apifyReturned: apifyCount,
    allowedLocations,
    message: apifyCount > rawJobs.length
      ? `Apify returned ${apifyCount} jobs; stored ${stored} in allowed locations.${locationNote}${domainNote}`
      : `Stored ${stored} Upwork job(s) in allowed locations.${locationNote}${domainNote}`
  });
}));

// GET /jobs/linkedin — get all LinkedIn jobs for a brand (for scraper page)
router.get('/jobs/linkedin', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const trackerStatus = req.query.trackerStatus;

  const filter = { brandId: brand._id };
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { 'company.name': { $regex: search, $options: 'i' } },
      { 'location.country': { $regex: search, $options: 'i' } }
    ];
  }
  if (trackerStatus && trackerStatus !== 'all') filter.trackerStatus = trackerStatus;

  if (isLinkedinGulfBrand(brand)) {
    const locOr = buildLinkedinGulfMongoOr(brand);
    if (locOr.length) {
      filter.$and = [...(filter.$and || []), { $or: locOr }];
    }
    filter['location.country'] = {
      ...(filter['location.country'] || {}),
      $not: /^(united states|germany|india|iceland|ethiopia|united kingdom|ukraine|canada|australia|france|netherlands)$/i
    };
  }

  const [jobs, total] = await Promise.all([
    LinkedinJob.find(filter).sort({ postedDate: -1 }).skip(skip).limit(limit).lean(),
    LinkedinJob.countDocuments(filter)
  ]);

  return res.json({
    jobs,
    total,
    page,
    pages: Math.ceil(total / limit),
    limit
  });
}));

// GET /jobs/upwork — get all Upwork jobs for a brand (for scraper page)
router.get('/jobs/upwork', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const paymentVerified = req.query.paymentVerified;
  const trackerStatus = req.query.trackerStatus;

  const filter = { brandId: brand._id };
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { clientName: { $regex: search, $options: 'i' } }
    ];
  }
  if (paymentVerified === 'true') filter.paymentVerified = true;
  if (trackerStatus && trackerStatus !== 'all') filter.trackerStatus = trackerStatus;

  if (shouldFilterUpworkByLocation(brand)) {
    const allowed = getUpworkAllowedLocations(brand);
    const locOr = buildClientLocationMongoOr(allowed);
    if (locOr.length) {
      filter.$and = [...(filter.$and || []), { $or: locOr }];
    }
    filter.clientLocation = {
      ...(filter.clientLocation || {}),
      $not: /ukraine|ukr\b/i
    };
  }

  const [jobs, total] = await Promise.all([
    UpworkJob.find(filter).sort({ absoluteDate: -1 }).skip(skip).limit(limit).lean(),
    UpworkJob.countDocuments(filter)
  ]);

  return res.json({
    jobs,
    total,
    page,
    pages: Math.ceil(total / limit),
    limit
  });
}));

// PUT /jobs/upwork/:id — update trackerStatus on an Upwork job
router.put('/jobs/upwork/:id', asyncHandler(async (req, res) => {
  const allowed = ['trackerStatus', 'userNotes', 'appliedAt', 'rejectedAt', 'coverLetter', 'coverLetterUpdatedAt'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const job = await UpworkJob.findOneAndUpdate(
    { _id: req.params.id, brandId: req.params.brandId },
    { $set: updates },
    { new: true }
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(job);
}));

// PUT /jobs/linkedin/:id — update trackerStatus on a LinkedIn job
router.put('/jobs/linkedin/:id', asyncHandler(async (req, res) => {
  const allowed = ['trackerStatus', 'userNotes', 'appliedAt', 'rejectedAt', 'coverLetter', 'coverLetterUpdatedAt'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const job = await LinkedinJob.findOneAndUpdate(
    { _id: req.params.id, brandId: req.params.brandId },
    { $set: updates },
    { new: true }
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(job);
}));

// DELETE /jobs/upwork/:id — delete an Upwork job
router.delete('/jobs/upwork/:id', asyncHandler(async (req, res) => {
  const job = await UpworkJob.findOneAndDelete({ _id: req.params.id, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json({ deleted: true });
}));

// DELETE /jobs/linkedin/:id — delete a LinkedIn job
router.delete('/jobs/linkedin/:id', asyncHandler(async (req, res) => {
  const job = await LinkedinJob.findOneAndDelete({ _id: req.params.id, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json({ deleted: true });
}));

// POST /jobs/upwork/:id/cover-letter/generate — generate (and persist) a cover letter for an Upwork job
router.post('/jobs/upwork/:id/cover-letter/generate', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  // Support lookup by Mongo _id (valid ObjectId) OR by native jobId string.
  const { ObjectId } = require('mongoose').Types;
  const paramId = String(req.params.id || '');
  const byObjectId = ObjectId.isValid(paramId);
  const job = byObjectId
    ? await UpworkJob.findOne({ _id: paramId, brandId: req.params.brandId })
    : await UpworkJob.findOne({ jobId: paramId, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Require a usable job description to build the cover letter.
  const description = job.description ? String(job.description).trim() : '';
  if (!description) {
    return res.status(400).json({ error: 'Job description is empty; cannot generate a cover letter.' });
  }

  const additionalInstructions = req.body?.additionalInstructions;

  // Profile-gated generation: use the human-selected (or AI-recommended) profile
  // as strict ground truth for the applicant's qualifications.
  let candidateProfile = null;
  if (job.selectedProfileId) {
    candidateProfile = await CandidateProfile.findById(job.selectedProfileId).lean();
  }

  let letter;
  try {
    letter = await generateUpworkCoverLetter(job, brand, additionalInstructions, candidateProfile);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Cover letter generation failed' });
  }

  const updated = await UpworkJob.findOneAndUpdate(
    { _id: job._id, brandId: brand._id },
    { $set: { coverLetter: letter, coverLetterUpdatedAt: new Date() } },
    { new: true }
  );

  return res.json({
    success: true,
    jobId: updated.jobId,
    coverLetter: updated.coverLetter,
    updatedAt: updated.coverLetterUpdatedAt
  });
}));

// POST /jobs/linkedin/:id/cover-letter/generate — generate (and persist) a cover letter via DeepSeek
router.post('/jobs/linkedin/:id/cover-letter/generate', asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.brandId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  const job = await LinkedinJob.findOne({ _id: req.params.id, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (!job.descriptionText || !job.descriptionText.trim()) {
    return res.status(400).json({ error: 'Job description is empty. Cannot generate a cover letter.' });
  }

  const additionalInstructions = req.body?.additionalInstructions;

  // Profile-gated generation: use the human-selected (or AI-recommended) profile
  // as strict ground truth for the applicant's qualifications.
  let candidateProfile = null;
  if (job.selectedProfileId) {
    candidateProfile = await CandidateProfile.findById(job.selectedProfileId).lean();
  }
  if (candidateProfile) {
    console.log(
      '[COVER LETTER ENGINE] Generating letter using candidate profile:',
      candidateProfile.name || candidateProfile._id,
      'for Job:',
      job._id
    );
  }

  let letter;
  try {
    letter = await generateCoverLetter(job, brand, additionalInstructions, candidateProfile);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Cover letter generation failed' });
  }

  const updated = await LinkedinJob.findOneAndUpdate(
    { _id: job._id, brandId: brand._id },
    { $set: { coverLetter: letter, coverLetterUpdatedAt: new Date() } },
    { new: true }
  );

  return res.json({
    jobId: updated._id,
    coverLetter: updated.coverLetter,
    updatedAt: updated.coverLetterUpdatedAt
  });
}));

// POST /jobs/upwork/:id/score — run (or re-run) profile scoring for an Upwork job
router.post('/jobs/upwork/:id/score', asyncHandler(async (req, res) => {
  const job = await UpworkJob.findOne({ _id: req.params.id, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  try {
    const result = await scoreProfilesForJob(job);
    if (!result) return res.status(400).json({ error: 'No candidate profiles available to score this job.' });
    return res.json({ success: true, top: result.top, scores: result.scores });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Profile scoring failed' });
  }
}));

// POST /jobs/linkedin/:id/score — run (or re-run) profile scoring for a LinkedIn job
router.post('/jobs/linkedin/:id/score', asyncHandler(async (req, res) => {
  const job = await LinkedinJob.findOne({ _id: req.params.id, brandId: req.params.brandId });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  try {
    const result = await scoreProfilesForJob(job);
    if (!result) return res.status(400).json({ error: 'No candidate profiles available to score this job.' });
    return res.json({ success: true, top: result.top, scores: result.scores });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Profile scoring failed' });
  }
}));

// PATCH /jobs/upwork/:id/select-profile — human override of the AI-recommended profile
router.patch('/jobs/upwork/:id/select-profile', asyncHandler(async (req, res) => {
  const { selectedProfileId } = req.body || {};
  if (!selectedProfileId) return res.status(400).json({ error: 'selectedProfileId is required' });

  const job = await UpworkJob.findOneAndUpdate(
    { _id: req.params.id, brandId: req.params.brandId },
    { $set: { selectedProfileId, selectionSource: 'MANUAL_OVERRIDE' } },
    { new: true }
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });

  console.log('[PROFILE OVERRIDE] Job:', job._id, 'Switched to Profile:', selectedProfileId);
  return res.json({ success: true, selectedProfileId: job.selectedProfileId, selectionSource: job.selectionSource });
}));

// PATCH /jobs/linkedin/:id/select-profile — human override of the AI-recommended profile
router.patch('/jobs/linkedin/:id/select-profile', asyncHandler(async (req, res) => {
  const { selectedProfileId } = req.body || {};
  if (!selectedProfileId) return res.status(400).json({ error: 'selectedProfileId is required' });

  const job = await LinkedinJob.findOneAndUpdate(
    { _id: req.params.id, brandId: req.params.brandId },
    { $set: { selectedProfileId, selectionSource: 'MANUAL_OVERRIDE' } },
    { new: true }
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });

  console.log('[PROFILE OVERRIDE] Job:', job._id, 'Switched to Profile:', selectedProfileId);
  return res.json({ success: true, selectedProfileId: job.selectedProfileId, selectionSource: job.selectionSource });
}));

module.exports = router;
