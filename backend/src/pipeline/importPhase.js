const Contact = require('../models/Contact');
const { LeadQualifier } = require('../services/qualifierService');

/**
 * Import phase: qualify and save leads to the DB.
 * @param {object} brand - mongoose Brand doc
 * @param {object} logger - logger with .info, .warn, .error, .debug
 * @param {object} opts - { leads?: Array, importSource?: string }
 * @returns {number} count of new contacts imported
 */
async function importPhase(brand, logger, opts = {}) {
  logger.info('--- IMPORT PHASE ---');

  const leads = opts.leads || [];
  if (!leads.length) {
    logger.warn('No leads provided to import phase');
    return 0;
  }

  logger.info(`Processing ${leads.length} raw leads...`);

  const qualifier = new LeadQualifier(logger, brand.qualification?.threshold ?? 6);
  const { qualified, stats } = qualifier.qualifyBatch(leads);

  logger.info(`Qualification: ${stats.qualified}/${stats.total} qualified (score >= ${brand.qualification?.threshold ?? 6})`);

  if (!qualified.length) {
    logger.warn('No leads passed qualification');
    return 0;
  }

  // Deduplicate by email within brand
  const emails = qualified
    .map(l => (l.email || '').toLowerCase().trim())
    .filter(Boolean);

  const existing = await Contact.find({
    brandId: brand._id,
    email: { $in: emails }
  }).select('email');

  const existingSet = new Set(existing.map(c => c.email.toLowerCase()));
  const toAdd = qualified.filter(l => l.email && !existingSet.has(l.email.toLowerCase().trim()));

  if (!toAdd.length) {
    logger.info(`All ${qualified.length} contacts already exist in DB`);
    return 0;
  }

  const docs = toAdd.map(l => ({
    brandId: brand._id,
    email: l.email.toLowerCase().trim(),
    firstName: l.first_name || '',
    lastName: l.last_name || '',
    fullName: l.full_name || '',
    jobTitle: l.job_title || '',
    headline: l.headline || '',
    seniorityLevel: l.seniority_level || '',
    functionalLevel: l.functional_level || '',
    companyName: l.company_name || l.organization_name || '',
    companyDomain: l.company_domain || '',
    companyWebsite: l.company_website || '',
    industry: l.industry || '',
    companySize: l.company_size ? String(l.company_size) : (l.employee_count ? String(l.employee_count) : ''),
    companyDescription: l.company_description || '',
    companyAnnualRevenue: l.company_annual_revenue || '',
    companyTotalFunding: l.company_total_funding_clean || '',
    companyLinkedin: l.company_linkedin || '',
    city: l.city || '',
    state: l.state || '',
    country: l.country || l.headquarters_country || '',
    technologyStack: Array.isArray(l.technology_stack)
      ? l.technology_stack
      : typeof l.company_technologies === 'string'
        ? l.company_technologies.split(',').map(s => s.trim()).filter(Boolean)
        : [],
    linkedinUrl: l.linkedin_url || l.linkedin || '',
    leadScore: l._score || 0,
    scoreBreakdown: l._score_breakdown || {},
    status: 'Pending',
    importSource: opts.importSource || 'json_upload'
  }));

  let inserted = 0;
  try {
    const result = await Contact.insertMany(docs, { ordered: false });
    inserted = result.length;
  } catch (err) {
    if (err.code === 11000 || err.name === 'MongoBulkWriteError') {
      // Partial insert — some duplicates slipped through
      inserted = err.result?.nInserted || err.insertedCount || 0;
    } else {
      throw err;
    }
  }

  logger.info(`Imported ${inserted} new contacts (${qualified.length - toAdd.length} duplicates skipped, ${toAdd.length - inserted} failed)`);
  return inserted;
}

module.exports = importPhase;
