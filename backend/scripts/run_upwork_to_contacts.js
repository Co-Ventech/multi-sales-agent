/**
 * run_upwork_to_contacts.js
 *
 * MANUAL PIPELINE — reads already-scraped upwork.jobs.json (no Apify needed for jobs)
 *
 * Steps:
 *   STEP 1  — Load jobs from upwork.jobs.json + companies from company_names.json
 *   STEP 2  — Save all 50 UpworkJob records to MongoDB
 *   STEP 3  — Run LinkedIn Employees actor for the 6 extracted company names
 *   STEP 4  — Save LinkedinContact records (one per employee)
 *   STEP 5  — Create Contact records  (one per job × employee — cartesian product)
 *             Each contact is linked to brand, upwork job(s), and linkedin contact
 */

require('dotenv').config({ path: require('path').join(__dirname, '../..', '.env') });

const fs         = require('fs');
const path       = require('path');
const mongoose   = require('mongoose');

// ── Models (use relative paths, not full pipeline imports) ──────────────────
const Brand          = require('../src/models/Brand');
const UpworkJob      = require('../src/models/UpworkJob');
const LinkedinContact = require('../src/models/LinkedinContact');
const Contact        = require('../src/models/Contact');

// ── Apify service ────────────────────────────────────────────────────────────
const { runActor, mapEmployeesToContacts } = require('../src/services/apifyService');

// ── Constants ────────────────────────────────────────────────────────────────
const LINKEDIN_EMPLOYEES_ACTOR = 'Vb6LZkh4EqRlR0Ka9';
const JOBS_FILE     = path.join(__dirname, '../upwork.jobs.json');
const COMPANIES_FILE = path.join(__dirname, 'company_names.json');

const DEFAULT_EMPLOYEE_INPUT = {
  functionIds: ['12'],                               // HR department
  profileScraperMode: 'Full + email search ($12 per 1k)',
  recentlyChangedJobs: false,
  maxItems: 10                                       // 10 employees per company
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function normalize(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function fuzzyMatch(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return na.split('').slice(0, 5).join('') === nb.split('').slice(0, 5).join('');
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const API_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
  if (!API_TOKEN) {
    console.error('ERROR: APIFY_API_TOKEN not found in .env');
    process.exit(1);
  }

  // Connect to MongoDB
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('ERROR: MONGO_URI not found in .env');
    process.exit(1);
  }

  log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  log('Connected.');

  // ── Find brand ────────────────────────────────────────────────────────────
  // Try to find co-ventech brand; fall back to first active brand
  let brand = await Brand.findOne({ slug: 'co-ventech' }).lean();
  if (!brand) brand = await Brand.findOne({ name: /coventech|co-ventech/i }).lean();
  if (!brand) brand = await Brand.findOne({ isActive: true }).lean();
  if (!brand) {
    console.error('ERROR: No brand found in database. Create a brand first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  log(`Brand: "${brand.name}" (${brand._id})`);

  // ── STEP 1: Load jobs + companies ────────────────────────────────────────
  log('\n══ STEP 1 — Load jobs and companies ══');

  if (!fs.existsSync(JOBS_FILE)) {
    console.error('ERROR: upwork.jobs.json not found at', JOBS_FILE);
    await mongoose.disconnect();
    process.exit(1);
  }
  const rawJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  log(`Loaded ${rawJobs.length} jobs from upwork.jobs.json`);

  if (!fs.existsSync(COMPANIES_FILE)) {
    console.error('ERROR: company_names.json not found. Run extract_companies.js first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  const companyEntries = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf-8'));
  log(`Loaded ${companyEntries.length} companies from company_names.json:`);
  companyEntries.forEach(c => log(`  • ${c.company} [${c.confidence}] — job: "${c.jobTitle}"`));

  // Build jobId → companyName map using the job IDs from company_names.json
  const jobIdToCompany = new Map();
  const companyToJobIds = {};  // companyName (normalized) → [jobId, ...]

  for (const entry of companyEntries) {
    const jobId  = entry.jobId;
    const name   = entry.company;
    const key    = normalize(name);

    jobIdToCompany.set(jobId, name);
    if (!companyToJobIds[key]) companyToJobIds[key] = { name, jobIds: [] };
    companyToJobIds[key].jobIds.push(jobId);
  }

  // ── STEP 2: Save UpworkJob records ───────────────────────────────────────
  log('\n══ STEP 2 — Save UpworkJob records to MongoDB ══');

  let jobsStored = 0;
  const savedJobsByJobId = {};  // jobId → savedJob._id

  for (const raw of rawJobs) {
    const jobId = raw.id || raw.subId || raw.url;
    const extractedCompany = jobIdToCompany.get(raw.id) || null;

    try {
      const saved = await UpworkJob.findOneAndUpdate(
        { brandId: brand._id, jobId },
        {
          $set: {
            brandId:                brand._id,
            jobId,
            url:                    raw.url                  || '',
            title:                  raw.title                || '',
            description:            raw.description          || '',
            budget:                 raw.budget               || null,
            clientLocation:         raw.clientLocation        || '',
            clientName:             raw.clientName            || null,
            clientNameConfidence:   raw.clientNameConfidence  || null,
            clientAvgHourlyRate:    raw.clientAvgHourlyRate   || null,
            clientRating:           raw.clientRating          || null,
            clientHireRatePercent:  raw.clientHireRatePercent || null,
            clientTotalSpent:       raw.clientTotalSpent      || null,
            hasHired:               raw.hasHired              || false,
            proposals:              raw.proposals             || null,
            paymentVerified:        raw.paymentVerified       || false,
            relativeDate:           raw.relativeDate          || '',
            absoluteDate:           raw.absoluteDate          || '',
            jobType:                raw.jobType               || '',
            experienceLevel:        raw.experienceLevel       || '',
            allowedApplicantCountries: raw.allowedApplicantCountries || [],
            tags:                   raw.tags                  || [],
            questions:              raw.questions             || [],
            status:                 'new',
            extractedCompany
          }
        },
        { upsert: true, new: true }
      );
      savedJobsByJobId[raw.id] = saved._id;
      jobsStored++;
    } catch (err) {
      log(`  WARN: UpworkJob upsert error for ${jobId}: ${err.message}`);
    }
  }
  log(`Stored ${jobsStored} / ${rawJobs.length} jobs.`);

  // ── STEP 3: LinkedIn Employees actor ─────────────────────────────────────
  log('\n══ STEP 3 — LinkedIn Employees Actor ══');

  const companyNamesList = companyEntries.map(c => c.company);

  // Check DB cache first — avoid re-paying for already-fetched companies
  const cachedByCompany = {};
  const needsLookup     = [];

  for (const name of companyNamesList) {
    const key    = normalize(name);
    const cached = await LinkedinContact.find({
      brandId: brand._id,
      companyName: { $regex: new RegExp(key, 'i') }
    }).lean();

    if (cached.length > 0) {
      cachedByCompany[key] = cached;
      log(`  CACHED: "${name}" → ${cached.length} employees already in DB`);
    } else {
      needsLookup.push(name);
    }
  }

  let freshEmployees = [];
  if (needsLookup.length > 0) {
    log(`  Running actor for ${needsLookup.length} new companies: ${needsLookup.join(', ')}`);

    try {
      const rawEmpItems = await runActor(API_TOKEN, LINKEDIN_EMPLOYEES_ACTOR, {
        ...DEFAULT_EMPLOYEE_INPUT,
        companies: needsLookup
      });

      log(`  Actor returned ${rawEmpItems?.length ?? 0} raw employees`);

      if (rawEmpItems?.length) {
        freshEmployees = mapEmployeesToContacts(rawEmpItems);
        log(`  Mapped ${freshEmployees.length} employees with valid emails`);

        // Add to cachedByCompany
        for (const emp of freshEmployees) {
          if (!emp.companyName) continue;
          const key = normalize(emp.companyName);
          if (!cachedByCompany[key]) cachedByCompany[key] = [];
          cachedByCompany[key].push(emp);
        }
      } else {
        log('  Actor returned 0 results (companies may not have public LinkedIn profiles)');
      }
    } catch (err) {
      log(`  ERROR: LinkedIn Employees actor failed — ${err.message}`);
      log('  Continuing with cached employees only...');
    }
  } else {
    log('  All companies already cached — skipping actor run.');
  }

  const totalEmployees = Object.values(cachedByCompany).reduce((s, arr) => s + arr.length, 0);
  log(`Total employees available (cached + fresh): ${totalEmployees}`);

  if (totalEmployees === 0) {
    log('\nWARN: No employees found for any company.');
    log('This can happen when:');
    log('  • The companies are too small to appear on LinkedIn');
    log('  • LinkedIn blocked the actor (use a paid proxy plan)');
    log('  • The company names need a LinkedIn URL (not just name)');
    log('\nJobs are saved to DB. Run again after resolving the above.');
    await mongoose.disconnect();
    return;
  }

  // ── STEP 4: Save LinkedinContact records ─────────────────────────────────
  log('\n══ STEP 4 — Save LinkedinContact records ══');

  let lcCreated = 0;
  const empToLcId = {};   // email → LinkedinContact._id

  for (const [companyKey, employees] of Object.entries(cachedByCompany)) {
    // Build job _id list for this company
    const entry     = Object.values(companyToJobIds).find(e => fuzzyMatch(e.name, companyKey));
    const rawJobIds = entry ? entry.jobIds : [];
    const dbJobIds  = rawJobIds.map(jid => savedJobsByJobId[jid]).filter(Boolean);

    for (const emp of employees) {
      if (!emp.email) continue;

      let lc = await LinkedinContact.findOne({ brandId: brand._id, email: emp.email });
      if (lc) {
        // Update job IDs
        const existingIds = new Set((lc.linkedinJobIds || []).map(id => id.toString()));
        for (const jid of dbJobIds) existingIds.add(jid.toString());
        lc.linkedinJobIds = [...existingIds];
        lc.companyName    = emp.companyName || lc.companyName;
        await lc.save();
        empToLcId[emp.email] = lc._id;
        log(`  UPDATED LC: ${emp.email}`);
      } else {
        lc = await LinkedinContact.create({
          brandId:        brand._id,
          email:          emp.email,
          firstName:      emp.firstName      || '',
          lastName:       emp.lastName       || '',
          fullName:       emp.fullName       || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
          jobTitle:       emp.jobTitle       || '',
          headline:       emp.headline       || '',
          linkedinUrl:    emp.linkedinUrl    || '',
          companyName:    emp.companyName    || '',
          companyLinkedin:emp.companyLinkedin|| '',
          industry:       emp.industry       || '',
          companySize:    emp.companySize    || '',
          companyWebsite: emp.companyWebsite || '',
          city:           emp.city           || '',
          state:          emp.state          || '',
          country:        emp.country        || '',
          linkedinJobIds: dbJobIds,
          status:         'Pending'
        });
        empToLcId[emp.email] = lc._id;
        lcCreated++;
        log(`  CREATED LC: ${emp.fullName || emp.email} @ ${emp.companyName}`);
      }
    }
  }
  log(`LinkedinContacts created: ${lcCreated}`);

  // ── STEP 5: Cartesian product → Contacts ─────────────────────────────────
  log('\n══ STEP 5 — Create Contacts (job × employee) ══');

  // Collect ALL employees found (across all company queries)
  // LinkedIn actor searches all 6 companies at once — returned employees may show
  // a different "current company" on their profile (e.g. small startups with no
  // LinkedIn page). We link ALL returned employees to ALL searched companies.
  const allEmployees = Object.values(cachedByCompany).flat();

  log(`  Strategy: link all ${allEmployees.length} employee(s) to all ${Object.keys(companyToJobIds).length} company job(s)`);

  let companiesMatched = 0;
  let contactsCreated  = 0;
  let contactsUpdated  = 0;

  for (const [companyKey, companyInfo] of Object.entries(companyToJobIds)) {
    // First try exact fuzzy match; fall back to ALL employees (since actor was
    // queried specifically for these companies)
    let matchedEmployees = [];
    for (const [empKey, emps] of Object.entries(cachedByCompany)) {
      if (fuzzyMatch(companyInfo.name, empKey)) {
        matchedEmployees = emps;
        break;
      }
    }

    // Fallback: if no name match, use ALL employees (they came from querying these companies)
    if (matchedEmployees.length === 0 && allEmployees.length > 0) {
      matchedEmployees = allEmployees;
      log(`  FALLBACK: "${companyInfo.name}" — using all ${allEmployees.length} employees (no exact name match)`);
    }

    if (matchedEmployees.length === 0) {
      log(`  SKIP: "${companyInfo.name}" — 0 employees found`);
      continue;
    }

    companiesMatched++;
    log(`\n  MATCH: "${companyInfo.name}" | ${matchedEmployees.length} employee(s) × ${companyInfo.jobIds.length} job(s)`);

    for (const jobId of companyInfo.jobIds) {
      const savedJobId = savedJobsByJobId[jobId];
      if (!savedJobId) continue;

      // Fetch the raw job to get title and URL
      const rawJob = rawJobs.find(j => j.id === jobId);
      if (!rawJob) continue;

      for (const emp of matchedEmployees) {
        if (!emp.email) continue;

        const existing = await Contact.findOne({ brandId: brand._id, email: emp.email });

        if (existing) {
          // Add this Upwork job ID if not already there
          const upworkIds = new Set((existing.upworkJobIds || []).map(id => id.toString()));
          if (!upworkIds.has(savedJobId.toString())) {
            existing.upworkJobIds = [...upworkIds, savedJobId];
          }
          if (!existing.linkedinContactId) existing.linkedinContactId = empToLcId[emp.email];
          await existing.save();
          contactsUpdated++;
          log(`    UPDATED contact: ${emp.email}`);
        } else {
          try {
            await Contact.create({
              brandId:         brand._id,
              email:           emp.email,
              firstName:       emp.firstName      || '',
              lastName:        emp.lastName       || '',
              fullName:        emp.fullName       || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
              jobTitle:        rawJob.title        || '',
              headline:        emp.headline       || '',
              linkedinUrl:     emp.linkedinUrl    || '',
              companyName:     companyInfo.name,
              companyLinkedin: emp.companyLinkedin|| '',
              industry:        emp.industry       || '',
              companySize:     emp.companySize    || '',
              companyWebsite:  emp.companyWebsite || '',
              city:            emp.city           || '',
              state:           emp.state          || '',
              country:         emp.country        || '',
              status:          'Pending',
              importSource:    'upwork-enriched',
              upworkJobIds:    [savedJobId],
              linkedinJobIds:  [],
              linkedinContactId: empToLcId[emp.email]
            });
            contactsCreated++;
            log(`    CREATED contact: ${emp.fullName || emp.email} → job "${rawJob.title?.slice(0,40)}"`);
          } catch (err) {
            if (err.code !== 11000) log(`    ERROR contact create: ${err.message}`);
          }
        }
      }
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('   PIPELINE COMPLETE');
  console.log('══════════════════════════════════════════════════');
  console.log(JSON.stringify({
    brand:               brand.name,
    jobsLoaded:          rawJobs.length,
    jobsStoredToMongo:   jobsStored,
    companiesExtracted:  companyNamesList.length,
    companiesMatched,
    employeesFound:      totalEmployees,
    linkedinContactsCreated: lcCreated,
    contactsCreated,
    contactsUpdated
  }, null, 2));

  await mongoose.disconnect();
  log('Done. MongoDB disconnected.');
}

main().catch(e => {
  console.error('FATAL ERROR:', e);
  mongoose.disconnect().finally(() => process.exit(1));
});
