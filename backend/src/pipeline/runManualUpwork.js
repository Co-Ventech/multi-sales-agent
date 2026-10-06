/**
 * runManualUpwork.js — Full Upwork pipeline test with new token
 * Brand: 6a0201f0136c62c5c6109c0a
 * Token: APIFY_API_TOKEN from Agents/.env
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../..', '.env') });
const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const UpworkJob = require('../models/UpworkJob');
const LinkedinContact = require('../models/LinkedinContact');
const Contact = require('../models/Contact');
const { runActor, mapEmployeesToContacts } = require('../services/apifyService');
const { extractAll } = require('../services/extractCompanyFromText');
const { getApifyToken, capJobScrapeInput } = require('../config/apify');
const { filterUpworkJobsForBrand } = require('../config/apifyUpworkLocationFilters');

const UPWORK_ACTOR = 'XYTgO05GT5qAoSlxy';
const LINKEDIN_EMPLOYEES_ACTOR = 'Vb6LZkh4EqRlR0Ka9';

const DEFAULT_EMPLOYEE_INPUT = {
  functionIds: ['12'],
  profileScraperMode: 'Full + email search ($12 per 1k)',
  recentlyChangedJobs: false,
  maxItems: 5
};

const KNOWN_FIRST_NAMES = new Set(['james','john','michael','david','robert','william','richard','thomas','charles','daniel','matthew','anthony','mark','paul','andrew','steven','kevin','brian','edward','ronald','timothy','jason','jeffrey','ryan','emma','olivia','sophia','isabella','ava','emily','abigail','elizabeth','mason','ethan','noah','liam','benjamin','oliver','alexander','henry','sebastian','sebastian','aidan','jacob','muhammad','larry','kim','tom','alex','chris','taylor','jordan','casey','riley','quinn','morgan','dana','lee','kelly','neil','sunita','ali','abdullah','abigale','max','joseph','chad','an','tiago','angry','therese','umut','colton','fannie','sandi','karina','urbano','antoine','roberto','joe','adam','eric','william']);

const REF_URL_REGEX = /https?:\/\/(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9\-]+\.(?:co\.uk|com|org|io|ai|app|net))\b/gi;

async function main() {
  const API_TOKEN = getApifyToken(null);
  if (!API_TOKEN) {
    console.error('Set APIFY_API_TOKEN in Agents/.env');
    process.exit(1);
  }

  await mongoose.connect('mongodb+srv://admin:admin@cluster0.ifu0n.mongodb.net/email-agent1?retryWrites=true&w=majority');

  const brand = await mongoose.model('Brand').findById('6a0201f0136c62c5c6109c0a').lean();
  console.log('\nBrand:', brand.name, brand._id.toString());

  // ── STEP 1: Run Upwork actor (small test) ─────────────────────────────
  console.log('\n[STEP 1] Running Upwork actor with brand filters...');

  const actorInput = capJobScrapeInput({
    query: brand.apify?.defaultInput?.query || 'qa-testing OR ai-machine-learning OR web-development',
    sort: 'newest',
    per_page: 10,
    location: brand.apify?.defaultInput?.location || ['United States', 'United Kingdom'],
    experienceLevel: brand.apify?.defaultInput?.experienceLevel || ['entry', 'intermediate', 'expert'],
    jobType: brand.apify?.defaultInput?.jobType || ['fixed', 'hourly'],
    maxJobAge: brand.apify?.defaultInput?.maxJobAge || { value: 24, unit: 'hours' },
    paymentVerified: brand.apify?.defaultInput?.paymentVerified ?? false
  });

  let rawJobItems;
  try {
    rawJobItems = await runActor(API_TOKEN, UPWORK_ACTOR, actorInput);
  } catch (err) {
    console.error('Upwork actor failed:', err.message);
    process.exit(1);
  }

  let rawJobs = Array.isArray(rawJobItems) ? rawJobItems : [];
  console.log('[STEP 1] Raw jobs fetched:', rawJobs.length);

  const locationFilter = filterUpworkJobsForBrand(rawJobs, brand);
  if (locationFilter.dropped > 0) {
    console.log(
      `[STEP 1] Location filter: kept ${locationFilter.kept}, dropped ${locationFilter.dropped} ` +
      `(allowed: ${locationFilter.allowedLocations.join(', ')})`
    );
  }
  rawJobs = locationFilter.items;

  if (!rawJobs.length) {
    console.log('No jobs — stopping');
    await mongoose.disconnect();
    return;
  }

  // ── STEP 2: Extract companies + store UpworkJob records ──────────────
  console.log('\n[STEP 2] Extracting company names and storing UpworkJob records...');

  const jobCompanyMap = new Map();
  const companyNames = new Set();

  for (const raw of rawJobs) {
    const { company: descCompany, linkedinUrls } = extractAll(raw.description || '');
    const domainMatches = [...(raw.description || '').matchAll(REF_URL_REGEX)];
    const domains = [...new Set(domainMatches.map(m => m[1]))];

    let bestCompany = null;
    if (descCompany) {
      bestCompany = descCompany;
    } else if (domains.length > 0) {
      bestCompany = domains[0].split('.')[0].replace(/[-]/g, ' ').split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    } else if (raw.clientName && !KNOWN_FIRST_NAMES.has(raw.clientName.toLowerCase())) {
      bestCompany = raw.clientName;
    }

    if (bestCompany) {
      companyNames.add(bestCompany);
      jobCompanyMap.set(raw.url, bestCompany);
      console.log(`  [${raw.id.substring(0,8)}] company: "${bestCompany}"`);
    } else {
      console.log(`  [${raw.id.substring(0,8)}] NO COMPANY (clientName="${raw.clientName}")`);
    }

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
          status: 'new',
          extractedCompany: bestCompany,
          extractedLinkedinUrls: linkedinUrls || [],
          extractedOtherUrls: domains || []
        }},
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error('UpworkJob upsert error:', err.message);
    }
  }

  console.log('\nCompanies extracted:', companyNames.size, [...companyNames]);

  // ── STEP 3: Check cache + LinkedIn Employees actor ───────────────────
  console.log('\n[STEP 3] Checking LinkedInContact cache...');

  const cachedEmployeesByCompany = {};
  const companiesNeedingLookup = [];

  for (const companyName of companyNames) {
    const key = companyName.toLowerCase().trim();
    const cached = await LinkedinContact.find({
      brandId: brand._id,
      companyName: { $regex: new RegExp('^' + key + '$', 'i') }
    }).lean();

    if (cached.length > 0) {
      cachedEmployeesByCompany[key] = cached;
      console.log(`  CACHED: ${companyName} (${cached.length})`);
    } else {
      companiesNeedingLookup.push(companyName);
    }
  }

  console.log(`Cached: ${Object.keys(cachedEmployeesByCompany).length} | Need actor: ${companiesNeedingLookup}`);

  let freshEmployees = [];
  if (companiesNeedingLookup.length > 0) {
    console.log(`\n[STEP 3b] Running LinkedIn Employees actor for: ${companiesNeedingLookup.join(', ')}`);
    try {
      const rawEmpItems = await runActor(API_TOKEN, LINKEDIN_EMPLOYEES_ACTOR, {
        ...DEFAULT_EMPLOYEE_INPUT,
        companies: companiesNeedingLookup
      });
      console.log('Actor returned', rawEmpItems?.length ?? 0, 'employees');
      if (rawEmpItems?.length) {
        freshEmployees = mapEmployeesToContacts(rawEmpItems);
        console.log('Mapped', freshEmployees.length, 'employees with emails');
        for (const emp of freshEmployees) {
          if (!emp.companyName) continue;
          const key = emp.companyName.toLowerCase().trim();
          if (!cachedEmployeesByCompany[key]) cachedEmployeesByCompany[key] = [];
          cachedEmployeesByCompany[key].push(emp);
        }
      }
    } catch (err) {
      console.error('LinkedIn Employees actor failed:', err.message);
    }
  }

  // ── STEP 4: Cartesian product → Contacts ────────────────────────────
  console.log('\n[STEP 4] Creating contacts (cartesian product)...');

  const jobsByCompany = {};
  for (const raw of rawJobs) {
    const name = jobCompanyMap.get(raw.url);
    if (!name) continue;
    if (!jobsByCompany[name]) jobsByCompany[name] = [];
    jobsByCompany[name].push(raw);
  }

  let companiesMatched = 0;
  let contactsCreated = 0;
  let jobsStored = 0;
  let lcCreated = 0;

  for (const [companyName, companyJobs] of Object.entries(jobsByCompany)) {
    const companyKey = companyName.toLowerCase().trim();
    const companyEmployees = cachedEmployeesByCompany[companyKey] || [];

    if (companyEmployees.length === 0) {
      console.log(`  [SKIP] ${companyName} — 0 employees`);
      continue;
    }

    companiesMatched++;
    console.log(`\n  [MATCH] ${companyName} | ${companyEmployees.length} employees × ${companyJobs.length} jobs`);

    const allJobIds = [];
    for (const job of companyJobs) {
      const savedJob = await UpworkJob.findOne({ brandId: brand._id, jobId: job.id || job.subId || job.url });
      if (savedJob) { allJobIds.push(savedJob._id); jobsStored++; }
    }

    const empToLcId = {};
    for (const emp of companyEmployees) {
      let existingLc = await LinkedinContact.findOne({ brandId: brand._id, email: emp.email });
      if (existingLc) {
        const existingIds = new Set((existingLc.linkedinJobIds || []).map(id => id.toString()));
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
        lcCreated++;
      }
    }

    for (const job of companyJobs) {
      const savedJob = await UpworkJob.findOne({ brandId: brand._id, jobId: job.id || job.subId || job.url });
      if (!savedJob) continue;

      for (const emp of companyEmployees) {
        const existingContact = await Contact.findOne({
          brandId: brand._id,
          linkedinUrl: job.url,
          email: emp.email
        });

        if (existingContact) {
          if (!existingContact.linkedinJobIds.includes(savedJob._id)) existingContact.linkedinJobIds.push(savedJob._id);
          if (!existingContact.upworkJobIds) existingContact.upworkJobIds = [];
          if (!existingContact.upworkJobIds.includes(savedJob._id)) existingContact.upworkJobIds.push(savedJob._id);
          if (!existingContact.linkedinContactId) existingContact.linkedinContactId = empToLcId[emp.email];
          await existingContact.save();
        } else {
          await Contact.create({
            brandId: brand._id,
            email: emp.email,
            firstName: emp.firstName || '',
            lastName: emp.lastName || '',
            fullName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
            jobTitle: job.title || '',
            linkedinUrl: emp.linkedinUrl || '',
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
            linkedinJobIds: [],
            linkedinContactId: empToLcId[emp.email],
            upworkJobIds: [savedJob._id]
          });
          contactsCreated++;
        }
      }
    }
    console.log(`  → +${contactsCreated} contacts (total)`);
  }

  console.log('\n══════════════════════════════════════');
  console.log('=== RESULT ===');
  console.log(JSON.stringify({
    companiesMatched,
    contactsCreated,
    jobsStored,
    linkedinContactsCreated: lcCreated,
    employeesFound: freshEmployees.length + Object.values(cachedEmployeesByCompany).reduce((s, a) => s + a.length, 0),
    rawJobs: rawJobs.length,
    companyList: [...companyNames]
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });