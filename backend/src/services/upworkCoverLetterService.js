/**
 * upworkCoverLetterService.js — AI cover letter generation for Upwork jobs.
 *
 * Thin adapter that maps an UpworkJob document onto the shape consumed by the
 * existing shared LLM prompt builder (deepseekService.generateCoverLetter).
 * This service is 100% additive: it reuses the existing generation pipeline and
 * never modifies it. It only reads job + brand fields and never writes the DB.
 */

const { generateCoverLetter } = require('./deepseekService');

const MAX_DESCRIPTION_CHARS = 6000;

/**
 * Translate an UpworkJob document into the prompt-friendly shape expected by
 * deepseekService.generateCoverLetter. Field names differ between the two
 * models, so we normalize them here (no schema/DB change).
 * @param {object} job - UpworkJob document
 * @returns {object} normalized job shape
 */
function toPromptShape(job) {
  const clientLocation = job.clientLocation || '';

  return {
    title: job.title,
    descriptionText: (job.description || '').slice(0, MAX_DESCRIPTION_CHARS),
    employmentType: job.jobType,
    experienceLevel: job.experienceLevel,
    // Collapse the free-text client location into the object shape the prompt
    // builder expects ([city, state, country] -> a single location string).
    location: {
      country: clientLocation
    },
    company: {
      name: job.clientName || undefined
    },
    // Surface MCP-enriched skills as specialities so the prompt can reference them.
    skills: Array.isArray(job.skills) ? job.skills : [],
    category: job.category,
    subcategory: job.subcategory
  };
}

/**
 * Generate (and return) a cover letter for an Upwork job.
 * @param {object} job - UpworkJob document (or plain object with Upwork fields)
 * @param {object} brand - Brand document (optional, company fallback)
 * @param {string} [additionalInstructions]
 * @param {object} [candidateProfile] - selected CandidateProfile used as strict
 *   ground truth for the applicant's qualifications
 * @returns {Promise<string>} the generated cover letter text
 * @throws {Error} with a `status`-like code on failure (mirrors deepseekService contract)
 */
async function generateUpworkCoverLetter(job, brand, additionalInstructions, candidateProfile) {
  if (!job || !job.description || !String(job.description).trim()) {
    const err = new Error('Job description is empty. Cannot generate a cover letter.');
    err.status = 400;
    throw err;
  }

  if (candidateProfile) {
    console.log(
      '[COVER LETTER ENGINE] Generating letter using candidate profile:',
      candidateProfile.name || candidateProfile._id,
      'for Job:',
      job._id || job.jobId
    );
  }

  const shape = toPromptShape(job);

  // Include MCP-enriched skills in the prompt when present.
  const promptJob = {
    ...shape,
    descriptionText: [
      shape.descriptionText,
      Array.isArray(job.skills) && job.skills.length
        ? `\n\nRequired skills: ${job.skills.join(', ')}`
        : ''
    ].filter(Boolean).join('')
  };

  return generateCoverLetter(promptJob, brand, additionalInstructions, candidateProfile);
}

module.exports = { generateUpworkCoverLetter, toPromptShape };
