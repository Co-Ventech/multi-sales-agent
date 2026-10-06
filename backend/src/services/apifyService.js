/**
 * apifyService.js — Run Apify actor IoSHqwTR9YGhzccez and return scraped leads
 *
 * Full input schema documented in data/apify_input_reference.json
 * Exact field names verified from live actor output.
 */

const { ApifyClient } = require('apify-client');

/**
 * Run an Apify actor and wait for it to finish.
 * @param {string} apiToken
 * @param {string} actorId
 * @param {object} input    - Actor input built from the form or raw JSON
 * @param {number} timeoutSecs
 * @returns {Array} raw items from dataset
 */
async function runActor(apiToken, actorId, input, timeoutSecs = 600) {
  const client = new ApifyClient({ token: apiToken });

  const run = await client.actor(actorId).call(input, {
    waitSecs: timeoutSecs
  });

  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Apify actor finished with status: ${run.status}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items || [];
}

/**
 * Map raw Apify actor output to our Contact schema.
 * Handles the exact field names returned by actor IoSHqwTR9YGhzccez.
 */
function mapToContacts(items) {
  return items.map(item => {
    const email = (item.email || item.emailAddress || item.work_email || '').trim();
    if (!email || !email.includes('@')) return null;

    // company_technologies is a comma-separated string in this actor
    let techStack = [];
    if (Array.isArray(item.technology_names)) {
      techStack = item.technology_names;
    } else if (Array.isArray(item.technologies)) {
      techStack = item.technologies;
    } else if (typeof item.company_technologies === 'string' && item.company_technologies) {
      techStack = item.company_technologies.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
    }

    return {
      email: email.toLowerCase(),
      firstName:    item.first_name  || '',
      lastName:     item.last_name   || '',
      fullName:     item.full_name   || `${item.first_name || ''} ${item.last_name || ''}`.trim(),
      jobTitle:     item.job_title   || item.title || '',
      headline:     item.headline    || '',
      seniorityLevel:  item.seniority_level  || '',
      functionalLevel: item.functional_level || '',
      emailStatus:  item.email_status || '',
      linkedinUrl:  item.linkedin    || item.linkedin_url || '',

      // Company — actor returns 'company_name' or 'organization_name'
      companyName:        item.company_name       || item.organization_name || '',
      companyDomain:      item.company_domain     || '',
      companyWebsite:     item.company_website    || '',
      companyLinkedin:    item.company_linkedin   || '',
      companyPhone:       item.company_phone      || '',
      industry:           item.industry           || '',
      companySize:        item.company_size != null ? String(item.company_size) : '',
      companyDescription: item.company_description || '',
      companyAnnualRevenue: item.company_annual_revenue_clean || item.company_annual_revenue || '',
      companyTotalFunding:  item.company_total_funding_clean  || item.company_total_funding  || '',

      // Location
      city:    item.city    || item.headquarters_city  || '',
      state:   item.state   || item.company_state       || '',
      country: item.country || item.headquarters_country || '',

      technologyStack: techStack,
      importSource: 'apify'
    };
  }).filter(Boolean);
}

/**
 * Map LinkedIn Jobs actor output to Contact schema.
 * Generates dummy emails — real emails come later via another actor using company LinkedIn URL.
 */
function mapLinkedInJobsToContacts(items) {
  return items.map(item => {
    if (!item.title || !item.company?.name) return null;

    const loc = item.location?.parsed || {};
    const company = item.company || {};

    // Dummy email — real email comes later when another actor finds people at this company
    const dummyEmail = `job-${item.id}@linkedin-imported`;

    return {
      email: dummyEmail,
      jobTitle: item.title || '',
      companyName: company.name || '',
      companyLinkedin: company.linkedinUrl || '',
      companyDescription: company.description || '',
      industry: company.industries?.[0] || '',
      companySize: company.employeeCountRange || '',
      linkedinUrl: item.linkedinUrl || '',
      city: loc.city || '',
      state: loc.state || '',
      country: loc.country || '',
      importSource: 'linkedin-jobs'
    };
  }).filter(Boolean);
}

/**
 * Map LinkedIn Company Employees actor output to Contact schema.
 * Used to enrich job postings with real employee emails from company LinkedIn URLs.
 */
function mapEmployeesToContacts(items) {
  return items.map(item => {
    if (!item.firstName && !item.lastName) return null;

    const loc = item.location?.parsed || {};
    const currentPos = item.currentPosition?.[0] || {};

    // Use real email if found, otherwise skip (employees without emails aren't useful)
    const email = item.emails?.[0]?.email || item.emails?.[0] || null;
    if (!email) return null;

    return {
      email: email.toLowerCase(),
      firstName: item.firstName || '',
      lastName: item.lastName || '',
      fullName: `${item.firstName || ''} ${item.lastName || ''}`.trim(),
      jobTitle: currentPos.position || item.headline || '',
      headline: item.headline || '',
      linkedinUrl: item.linkedinUrl || '',
      companyName: currentPos.companyName || '',
      companyLinkedin: currentPos.companyLinkedinUrl || '',
      industry: currentPos.company?.industries?.[0]?.name || '',
      companySize: currentPos.company?.employeeCountRange
        ? `${currentPos.company.employeeCountRange.start}-${currentPos.company.employeeCountRange.end}`
        : '',
      companyDescription: currentPos.company?.description || '',
      companyWebsite: currentPos.company?.website || '',
      city: loc.city || item.location?.linkedinText || '',
      state: loc.state || '',
      country: loc.country || '',
      importSource: 'linkedin-employees'
    };
  }).filter(Boolean);
}

/**
 * Map raw LinkedIn job posting to a LinkedinJob document fields.
 * Extracts ALL rich fields from the LinkedIn Jobs actor output.
 */
function mapToLinkedinJob(item, brandId) {
  const loc = item.location?.parsed || {};

  return {
    brandId,
    linkedinUrl:     item.linkedinUrl || '',
    title:           item.title       || '',

    descriptionText: item.descriptionText || '',
    descriptionHtml: item.descriptionHtml || '',

    employmentType:  item.employmentType  || '',
    workplaceType:   item.workplaceType   || '',
    experienceLevel: item.experienceLevel || '',
    jobFunctions:    Array.isArray(item.jobFunctions)    ? item.jobFunctions    : [],
    benefits:        Array.isArray(item.benefits)        ? item.benefits        : [],

    salaryText: item.salary?.text || null,
    salaryMin:  item.salary?.min != null ? Number(item.salary.min) : null,
    salaryMax:  item.salary?.max != null ? Number(item.salary.max) : null,

    applicants: item.applicants != null ? Number(item.applicants) : null,
    views:      item.views      != null ? Number(item.views)      : null,
    postedDate: item.postedDate ? new Date(item.postedDate) : null,
    expiredAt:  item.expireAt  ? new Date(item.expireAt)  : null,

    location: {
      linkedinText: item.location?.linkedinText || loc.linkedinText || loc.text || '',
      countryCode:  item.location?.countryCode  || loc.countryCode  || '',
      regionCode:   item.location?.regionCode   || loc.regionCode   || '',
      city:         loc.city         || item.location?.city || '',
      state:        loc.state        || item.location?.state || '',
      country:      loc.country      || item.location?.country || loc.countryFull || ''
    },

    company: {
      name:        item.company?.name        || '',
      linkedinUrl: item.company?.linkedinUrl || '',
      website:     item.company?.website    || '',
      description: item.company?.description || '',
      size:        item.company?.employeeCountRange
                     ? `${item.company.employeeCountRange.start}-${item.company.employeeCountRange.end}`
                     : item.company?.employeeCount || '',
      logo:        item.company?.logo       || '',
      coverImage:  item.company?.backgroundCover || '',
      followerCount: item.company?.followerCount != null
                     ? Number(item.company.followerCount) : null,
      locations: (item.company?.locations || []).map(l => ({
        country:        l.country        || '',
        geographicArea: l.geographicArea || '',
        city:           l.parsed?.city  || l.city || '',
        headquarter:    l.headquarter   || false,
        text:           l.parsed?.text || l.text || ''
      })),
      industries: (item.company?.industries || []).map(i => ({
        id:   i.id   || '',
        name: i.name || ''
      })),
      specialities: Array.isArray(item.company?.specialities)
                       ? item.company.specialities : []
    },

    applyMethod: {
      type:           item.applyMethod?.type           || '',
      companyApplyUrl: item.applyMethod?.companyApplyUrl || ''
    },

    query: item.query || {}
  };
}

module.exports = {
  runActor,
  mapToContacts,
  mapLinkedInJobsToContacts,
  mapEmployeesToContacts,
  mapToLinkedinJob
};
