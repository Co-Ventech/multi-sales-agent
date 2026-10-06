/**
 * deepseekService.js — Cover-letter generation via DeepSeek's OpenAI-compatible API.
 *
 * Fully isolated from openaiService.js. Uses its own env var (DEEPSEEK_API_KEY)
 * and its own base URL. Reads only job + brand fields; never mutates the DB.
 */

const OpenAI = require('openai');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_TIMEOUT_MS = 30000;
const MAX_DESCRIPTION_CHARS = 6000;
const MAX_WORDS = 400;

const COVER_LETTER_SYSTEM_PROMPT = `COVER LETTER TEMPLATE
PURPOSE
Generate a professional, concise, job-specific cover letter using the selected candidate's verified information and the scraped job information.
The structure, tone, and writing style must remain consistent for every job. Only job-relevant candidate details and job-specific information may change.

FIXED STRUCTURE
1. Opening
Start directly with the client's requirement and connect it to the candidate's relevant experience.
Do not use generic introductions.

2. Relevant Fit
Mention the candidate's most relevant skills, technologies, and experience that directly match the job requirements.
Only include relevant information. Do not list the candidate's complete skill set.

3. Relevant Experience / Approach
Mention one or two verified relevant projects, responsibilities, or areas of experience.
Briefly explain how the candidate's experience relates to the client's requirements.
If appropriate, briefly mention the technical approach the candidate would take.

4. Closing
End with a short, professional statement indicating that the candidate is available to discuss the requirements further.
Use:
Best regards,
[CANDIDATE NAME]
DYNAMIC FIELDS
Only these elements may change according to the job and selected candidate:
[CANDIDATE NAME]
[CANDIDATE TITLE]
[JOB TITLE]
[JOB REQUIREMENT]
[RELEVANT SKILLS]
[RELEVANT TECHNOLOGIES]
[RELEVANT EXPERIENCE]
[RELEVANT PROJECT]
[RELEVANT DOMAIN EXPERIENCE]
[RELEVANT TECHNICAL APPROACH]
CANDIDATE INFORMATION RULES
Use only verified information from the selected candidate's CV/profile.
Never invent or assume:

Experience
Years of experience
Projects
Clients
Technologies
Certifications
Responsibilities
Achievements
Metrics
Job titles
Domain experience
If an exact requirement is not supported by the candidate's information, do not claim it.
Use the closest relevant verified experience instead.

JOB RELEVANCE
Prioritize information in this order:

Exact technology match
Exact responsibility match
Similar project experience
Related domain experience
Transferable experience
Mention only information that strengthens the candidate's relevance to the specific job.

WRITING STYLE
Always write in a:

Professional
Clear
Direct
Concise
Natural
Confident
Human-sounding
style.
Avoid excessive formality, unnecessary explanations, marketing language, and exaggerated claims.

LENGTH
Target 120–180 words.
Never exceed 200 words unless the job explicitly requires substantial technical detail.

FORMATTING
Use 3–4 short paragraphs.
Do not use:

Bullet points
Numbered lists
Headings
Emojis
Hashtags
Markdown
Excessive punctuation
Long paragraphs
STRICTLY AVOID
Do not use generic or AI-style phrases such as:
"I am excited to apply"
"I am thrilled to apply"
"I would love the opportunity"
"I would be a great fit"
"I am the perfect candidate"
"I am confident that I am the ideal candidate"
"With my extensive experience"
"Leverage my expertise"
"Cutting-edge solutions"
"Passionate about"
"Proven track record"
"Results-driven professional"
"Take your project to the next level"
"Seamless and scalable solution"
Use simple, direct professional language instead.

PERSONALIZATION RULE
Every cover letter must contain specific information from the job description and connect it to verified candidate information.
The letter must NOT be reusable for an unrelated job without modification.

FINAL TEMPLATE
[OPENING]
Directly reference the most important requirement from the job and connect it to the candidate's relevant experience.
[RELEVANT FIT]
Explain why the candidate's relevant skills, technologies, and experience match the client's requirements. Mention only the strongest relevant points.
[RELEVANT EXPERIENCE / APPROACH]
Mention one or two verified relevant experiences or projects and briefly connect them to the work required. If appropriate, explain the candidate's relevant technical approach.
[CLOSING]
End with a concise professional statement indicating availability to discuss the requirements further.
Best regards,
[CANDIDATE NAME]
FINAL VALIDATION
Before returning the cover letter, verify:

Candidate information is accurate.
No information has been invented.
The letter is specific to the job.
Only relevant candidate information is included.
The fixed structure is maintained.
The tone is professional and natural.
The letter is concise.
No generic AI phrases are used.
No unnecessary information is included.
Return ONLY the completed cover letter.`;

const PROFILE_EXTRACTION_SYSTEM_PROMPT = `You are a resume parser. Extract structured candidate profile data from the resume text provided.
OUTPUT ONLY VALID RAW JSON. DO NOT INCLUDE MARKDOWN CODEBLOCKS OR ANY EXTRA TEXT.
Return ONLY valid JSON (no markdown, no prose, no comments) matching this exact schema:
{
  "name": "full name or null",
  "professionalTitle": "current or most recent title or null",
  "yearsOfExperience": number or null,
  "primarySkills": ["..."],
  "secondarySkills": ["..."],
  "technologies": ["..."],
  "frameworks": ["..."],
  "tools": ["..."],
  "cloudPlatforms": ["..."],
  "certifications": ["..."],
  "projectExperience": [{"title": "...", "description": "...", "technologies": ["..."]}],
  "employmentHistory": [{"title": "...", "company": "...", "duration": "...", "description": "..."}],
  "education": [{"degree": "...", "institution": "...", "year": "..."}]
}
Rules:
- Use empty arrays or null for anything not present in the resume.
- NEVER invent skills, employers, projects, certifications, or dates.`;

const PROFILE_SCORING_SYSTEM_PROMPT = `You are an expert technical recruiter scoring candidates against a job posting. Your goal is to rank candidates by TRUE fit for the job, NOT by isolated keyword overlap.
OUTPUT ONLY VALID RAW JSON. DO NOT INCLUDE MARKDOWN CODEBLOCKS OR ANY EXTRA TEXT.

CORE ROLE AFFINITY HIERARCHY (MANDATORY — ALWAYS APPLY):
Every candidate MUST be evaluated through this three-tier hierarchy, and the final "score" MUST be computed from exactly these weights:
- TIER 1 — ROLE ALIGNMENT (50% weight): the candidate's core functional identity (e.g., Software Engineering, Quality Assurance, UI/UX Design, Content/Marketing, Data Analytics, DevOps) versus the primary deliverable requested in the job title. This tier dominates the final score.
- TIER 2 — TECH STACK & TOOLING OVERLAP (30% weight): the depth of overlap across the ENTIRE required stack — frontend, backend, databases, APIs, DevOps, and any named tools. Overlap across 3+ layers is a strong match; a single isolated keyword is a weak match.
- TIER 3 — SENIORITY & CONTEXT (20% weight): years of experience, project scope, responsibility level, and other contextual fit against the level the job requires.

DOMAIN MISMATCH CEILING (MANDATORY, HARD RULE):
Analyze the candidate's core functional identity. If it belongs to a completely different domain than the primary deliverable requested in the job title (e.g., a QA candidate for a Software Development job, or a UI/UX Designer for a Backend job), the candidate's maximum possible score MUST NOT exceed 30% — regardless of shared tools or keyword overlap.

INVIOLABLE DOMAIN CAP (MANDATORY, STRICTER HARD RULE):
A candidate whose primary domain is Quality Assurance, UI Design, or Marketing MUST NEVER receive a score higher than 25% on a Software Development or Integration job. This 25% cap is absolute and overrides the 30% ceiling above.

TRANSFERABILITY RULE (MANDATORY):
When evaluating jobs requesting niche, proprietary, or specific emerging tools (e.g., custom CMS, proprietary SDKs, specialized integrations), evaluate candidate suitability based on Core Structural Competency (e.g., general API design, database administration, auth systems). Do NOT penalize software engineers severely for lacking a specific brand-name tool if they possess the foundational engineering discipline.

INTENT VECTOR ANALYSIS (MANDATORY — PERFORM BEFORE SCORING ANY CANDIDATE):
Deconstruct the job description into three explicit intent vectors, then base ALL scoring on them:
- VECTOR 1 — PRIMARY ACTION & SCOPE: the job's dominant deliverable activity (e.g., Infrastructure Setup / Deployment / Hardware QA vs. Feature Engineering / UI Build).
- VECTOR 2 — CORE DATA & SYSTEM LAYER: the system/data layer the work actually operates on (e.g., relational/NoSQL databases, auth, APIs, serverless backends vs. pure client-side rendering).
- VECTOR 3 — EXECUTION CONSTRAINTS: hard constraints on HOW the work is executed (e.g., Vanilla JS / No-Build / real-device testing vs. modern frameworks / node bundlers).

DELIVERABLE-TO-CAPABILITY SCORING RULES (MANDATORY):
- If a job's primary scope is Deployment & Database Setup (e.g., standing up databases, running schemas, auth provisioning), candidates lacking backend/database/DevOps experience MUST be heavily penalized under the "techStack" (technologyMatch) and "domain" (domainMatch) criteria — regardless of frontend web skills.
- If a job explicitly specifies "No Framework / Vanilla JS / No Build Step", candidates whose entire experience relies strictly on heavy modern frameworks without core architectural relevance MUST NOT receive top-tier technology scores.
- Match candidate ACCOMPLISHMENTS against the job's Required Action Verbs (e.g., Deploy, Setup DB, Test on Hardware), not just noun keywords (e.g., Web App). A candidate who has demonstrably performed the action the job requires outranks one who merely lists the matching noun.

COMPLETENESS REQUIREMENT (MANDATORY): You MUST return a score object for EVERY SINGLE candidate provided in the CANDIDATE LIST array. Do NOT truncate, skip, or omit any candidate under any circumstance. The number of entries in "scores" MUST exactly equal the number of candidates in the CANDIDATE LIST — no exceptions, even for sparse or low-fit profiles.

MANDATORY COUNT COMPLIANCE: The 'scores' array in your output JSON MUST contain EXACTLY ONE entry per candidate in the input CANDIDATE LIST. If the CANDIDATE LIST contains 8 candidates, your 'scores' array MUST contain exactly 8 objects. If it contains 10, it MUST contain exactly 10. Do NOT output 3, 5, or any truncated subset. Omitting a candidate is a critical error — every listed candidate must appear in 'scores'. Count your entries before responding.

CRITICAL — PROFILE ID EXACT MATCH (MANDATORY): The "profileId" value in your output JSON MUST be an EXACT, verbatim copy of the "_id" string provided for that candidate in the CANDIDATE LIST. Do NOT reformat, re-encode, add/remove whitespace, convert to a number, or otherwise alter the profileId string. The downstream system matches on exact string equality. A mismatched profileId causes the candidate's score to be silently dropped and replaced with a fallback, giving them a much lower score. Double-check every profileId before outputting.

PRECISION REQUIREMENT (MANDATORY):
Return precise floating-point scores with up to 2-3 decimal places (e.g., 30.65, 78.42, 84.12) to reflect subtle distinctions in skill alignment and experience depth. Do NOT round "score" to whole integers. The per-criterion scores (skills, experience, techStack, seniority, domain, other) may also include decimals.

REASONING-SCORE ALIGNMENT REQUIREMENT (MANDATORY):
The "reasoning" string in the JSON output must explicitly reference the candidate's specific strengths or gaps and MUST align cleanly with the final returned numerical score. Do NOT write static text referencing arbitrary caps; evaluate the candidate's actual calculated fit.

CANDIDATE-SPECIFIC REASONING REQUIREMENT (MANDATORY):
The "reasoning" field MUST be a 1-2 sentence candidate-specific analysis highlighting exact resume skills (e.g., 'Sara's 7+ years in Cypress and Playwright automated testing directly align with the framework setup requirements'). NEVER return generic or repetitive template text.

STEP 1 — DECONSTRUCT THE JOB (INTENT VECTOR ANALYSIS):
- From the JOB ANALYSIS section (job title, core role category, required skills, full description), first decompose the job into the three intent vectors mandated by INTENT VECTOR ANALYSIS:
  VECTOR 1 (Primary Action & Scope), VECTOR 2 (Core Data & System Layer), VECTOR 3 (Execution Constraints).
- Then determine:
  1. The job's CORE ROLE CATEGORY (e.g., Fullstack Web, Frontend Web, Backend, AI/ML, Mobile, DevOps, Data, General).
  2. The job's REQUIRED TECHNOLOGY STACK broken down by layer: Frontend frameworks (React, Vue, Angular, Next.js, Tailwind...), Backend runtimes (Node, Python, Go, Java, .NET, PHP...), Databases (PostgreSQL, MySQL, MongoDB, Redis...), APIs (REST, GraphQL...), DevOps (Docker, Kubernetes, CI/CD, AWS/GCP/Azure...).

STEP 2 — TIER 1: ROLE ALIGNMENT (50%):
- Compare each candidate's PRIMARY functional identity (professionalTitle, employment history, project experience) against the job's core role category. This is the single most important scoring factor.
- A candidate whose PRIMARY specialization is a DIFFERENT domain from the job MUST score materially lower than a candidate whose primary role matches — UNLESS that candidate has direct, production-grade, recent experience in the exact stack the job requires.
- If the job's primary scope (VECTOR 1) is Deployment & Database Setup, role alignment is judged by backend/database/DevOps deliverables — strong frontend skills do NOT compensate for missing deployment/database capability.
- Example: For a "Fullstack Web React/Node" job, an AI/ML Engineer MUST score lower than a dedicated Fullstack or Backend Web Developer, even if the AI engineer lists JavaScript among secondary skills.
- Example: For an "AI/ML Engineer" job, a Fullstack Web Developer with no model-training/production-ML experience MUST score lower than a dedicated AI/ML Engineer.

STEP 3 — TIER 2: TECH STACK & TOOLING OVERLAP (30%):
- Evaluate overlap across the ENTIRE stack the job requires: Frontend, Backend, Databases, APIs, DevOps, and any named tools.
- Weight each layer by what the job emphasizes. Do NOT award techStack credit for an isolated keyword overlap if the candidate lacks the surrounding stack (e.g., listing "React" alone is not equivalent to covering the React/Node/PostgreSQL stack).
- If VECTOR 3 specifies No Framework / Vanilla JS / No Build Step, do NOT award top-tier techStack scores to candidates whose stack is exclusively heavy modern frameworks without core architectural relevance.

STEP 4 — TIER 3: SENIORITY & CONTEXT (20%):
- Compare the candidate's years of experience and project context directly against the level and years required by the job description. Junior-level experience must not be scored as senior for a senior-required role.

STEP 5 — DOMAIN MISMATCH PENALTY (MANDATORY):
- If the candidate's core role does NOT align with the job's core role, set coreRoleMatch=false and cap the final "score" at no more than 30% (per the Domain Mismatch Ceiling). A core-role-mismatched candidate must NEVER receive a top-tier overall score, no matter how impressive their adjacent skills are.
- On Software Development / Integration jobs, candidates whose primary domain is Quality Assurance, UI Design, or Marketing MUST NEVER exceed 25% (per the Inviolable Domain Cap).
- If the job's primary scope is Deployment & Database Setup, candidates lacking backend/database/DevOps experience MUST have "domain" and "techStack" scored low even if they possess strong frontend skills.
- When the job requires niche/proprietary tools, apply the Transferability Rule: score foundational engineering competency (API design, database administration, auth systems) rather than punishing a missing brand-name tool.

STEP 6 — ASSIGN CRITERION SCORES (each 0-100) AND COMPUTE THE FINAL SCORE:
- Score each criterion 0-100 strictly from the evidence:
  - skills: how well the candidate's skills match the job's required skills
  - experience: relevance and depth of the candidate's work experience
  - techStack: FULL technology overlap across frontend, backend, databases, APIs, and DevOps
  - seniority: how well the candidate's level/seniority matches the job's required level
  - domain: how closely the candidate's core functional domain aligns with the job's core role (this drives TIER 1)
  - other: any other requirements such as languages, certifications, or soft skills
- Compute the final "score" using the mandated Core Role Affinity Hierarchy:
  score = (0.50 x role alignment) + (0.30 x tech stack & tooling overlap) + (0.20 x seniority & context)
  Role alignment is driven primarily by the "domain" criterion; tech stack & tooling overlap by the "techStack" and "skills" criteria; seniority & context by the "seniority", "experience", and "other" criteria.
- If a candidate's primary stack does NOT match the core application layer requested in the job title, score domain AND techStack near 0 (0-10) for that candidate — adjacent or hobby-level keyword overlaps must not inflate these criteria.
- If the Domain Mismatch Ceiling applies (STEP 5), the final "score" MUST be <= 30; if the Inviolable Domain Cap applies, the final "score" MUST be <= 25.

Return STRICTLY the following JSON (no markdown, no prose, no comments):
{
  "intentVectors": {
    "primaryActionAndScope": "<VECTOR 1 — one short phrase, e.g., 'Deployment & Database Setup' or 'Feature Engineering / UI Build'>",
    "coreDataAndSystemLayer": "<VECTOR 2 — one short phrase, e.g., 'Serverless backend, database, auth, APIs' or 'Pure client-side rendering'>",
    "executionConstraints": "<VECTOR 3 — one short phrase, e.g., 'Vanilla JS / No-Build / real-device testing' or 'Modern frameworks / node bundlers'>"
  },
  "scores": [
    {
      "profileId": "<exact candidate _id string copied verbatim from the CANDIDATE LIST — never guess or fuzzy-match>",
      "profileName": "<candidate name>",
      "coreRoleMatch": true or false,
      "criteriaScores": { "skills": 0-100, "experience": 0-100, "techStack": 0-100, "seniority": 0-100, "domain": 0-100, "other": 0-100 },
      "score": <final overall 0-100 as a precise floating-point number with 2-3 decimal places (e.g., 30.65, 78.42, 84.12) computed from the 0.50/0.30/0.20 hierarchy; NEVER above 30 when the Domain Mismatch Ceiling applies, and NEVER above 25 for QA/UI Design/Marketing candidates on Software Development/Integration jobs (Inviolable Domain Cap)>,
      "reasoning": "1-2 sentence explanation explicitly citing score deductions or bonuses, e.g., 'Core role is Quality Assurance vs. Fullstack Web role — domain mismatch ceiling applied, score capped at 30%. Strong test tooling but no frontend framework experience, capping techStack overlap.'"
    }
  ]
}
Rules:
- Base every score ONLY on evidence explicitly present in the candidate profile and the job description. Never infer unlisted skills.
- If a profile lacks evidence for a criterion, score it low (0-40) rather than guessing.
- Include exactly one entry per provided profile.
- You MUST return a score object for EVERY SINGLE candidate in the CANDIDATE LIST. Never truncate, skip, or omit any candidate — the count of "scores" entries must match the candidate count exactly.
- A candidate whose core role does NOT match the job must NEVER receive a top-tier overall score; when the Domain Mismatch Ceiling applies, cap the score at 30.
- The reasoning MUST be transparent: explicitly name which criteria scored high (bonus) and which scored low (deduction), and state whether a domain-mismatch penalty/ceiling was applied.`;

const MAX_PROFILE_JSON_CHARS = 12000;

function buildUserPrompt(job, brand, additionalInstructions, candidateProfile) {
  const company = job.company || {};
  const location = job.location || {};
  const desc = (job.descriptionText || '').slice(0, MAX_DESCRIPTION_CHARS);

  const parts = [
    `Title: ${job.title || 'Not provided'}`,
    `Company: ${company.name || brand?.company?.name || brand?.name || 'Not provided'}`,
    `Company Description: ${company.description || 'Not provided'}`,
    `Industries: ${(company.industries || []).map((i) => i.name || i).filter(Boolean).join(', ') || 'Not provided'}`,
    `Specialities: ${(company.specialities || []).filter(Boolean).join(', ') || 'Not provided'}`,
    `Employment Type: ${job.employmentType || 'Not specified'}`,
    `Experience Level: ${job.experienceLevel || 'Not specified'}`,
    `Location: ${[location.city, location.state, location.country].filter(Boolean).join(', ') || 'Not specified'}`,
    '',
    'Job Description:',
    desc || 'Not provided'
  ];

  if (additionalInstructions && String(additionalInstructions).trim()) {
    parts.push('', `Additional instructions from the applicant: ${String(additionalInstructions).trim()}`);
  }

  // Candidate profile is the strict ground truth for the applicant. Only include
  // the structured fields (never rawText) to keep tokens bounded.
  if (candidateProfile && typeof candidateProfile === 'object' && Object.keys(candidateProfile).length) {
    const { _id, brandId, rawText, sourceHash, parsedAt, updatedAt, createdAt, __v, ...groundTruth } = candidateProfile;
    parts.push('', 'Candidate Profile (GROUND TRUTH — the ONLY source of truth for the applicant\'s skills, experience, certifications, and achievements):', JSON.stringify(groundTruth, null, 2));
  }

  return parts.join('\n');
}

/**
 * Defensive JSON extraction for raw LLM output.
 *
 * DeepSeek occasionally wraps JSON in markdown fences, prepends conversational
 * preamble, appends postamble, emits raw control characters inside string
 * values, or truncates mid-structure. This walks several progressively more
 * aggressive repair passes before giving up:
 *   1. strip markdown code fences (```json / ```) and trim whitespace
 *   2. regex-extract the outermost JSON block ({...} or [...])
 *   3. drop trailing commas
 *   4. neutralize raw control characters (unescaped newlines/tabs, etc.)
 *   5. repair unescaped double quotes inside string values
 * A `DEEPSEEK_JSON` error is thrown only after every pass has been attempted.
 */
function parseJsonFromText(text) {
  const raw = String(text || '').trim();

  // Strip markdown code fences: ```json ... ``` (and any stray ``` markers).
  const noFences = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Regex-extract candidate JSON blocks, dropping any conversational
  // preamble/postamble. An object block is preferred (the expected response
  // shape for extraction/scoring), but both structures are kept so a stray
  // `[ ... ]` in the preamble never discards the real object block.
  const objMatch = noFences.match(/\{[\s\S]*\}/);
  const arrMatch = noFences.match(/\[[\s\S]*\]/);
  const blockCandidates = [];
  if (objMatch) blockCandidates.push(objMatch[0]);
  if (arrMatch) blockCandidates.push(arrMatch[0]);

  // Remove trailing commas (common LLM artifact: { "a": 1, } or [1, 2, ]).
  const stripTrailingCommas = (s) => s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  // Replace raw control characters (unescaped newlines/tabs/etc. inside string
  // values) with a single space so the surrounding JSON stays structurally valid.
  const sanitizeControlChars = (s) => s.replace(/[\u0000-\u001F\u007F]/g, ' ');

  // Best-effort repair of unescaped double quotes inside string VALUES. Runs
  // only as a final pass; structural quotes are preserved via a stateful scan
  // (a quote is kept structural when followed by a JSON boundary token).
  function repairUnescapedQuotes(input) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (inString) {
        if (ch === '\\') { out += ch; escaped = true; continue; }
        if (ch === '"') {
          const nextMatch = input.slice(i + 1).match(/\S/);
          const nextCh = nextMatch ? nextMatch[0] : '';
          if (nextCh === ',' || nextCh === '}' || nextCh === ']' || nextCh === ':') {
            out += ch; inString = false; continue;
          }
          out += '\\"';
          continue;
        }
        out += ch;
        continue;
      }
      if (ch === '"') { inString = true; out += ch; continue; }
      out += ch;
    }
    return out;
  }

  // Progressive repair passes — the first parseable candidate wins.
  const candidates = [];
  for (const block of blockCandidates) {
    candidates.push(stripTrailingCommas(block));
    candidates.push(stripTrailingCommas(sanitizeControlChars(block)));
    candidates.push(stripTrailingCommas(repairUnescapedQuotes(sanitizeControlChars(block))));
  }
  candidates.push(stripTrailingCommas(sanitizeControlChars(noFences)));
  candidates.push(stripTrailingCommas(noFences));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed !== null && parsed !== undefined) return parsed;
    } catch (e) { /* try the next repair pass */ }
  }

  const err = new Error('DeepSeek returned unparseable JSON');
  err.code = 'DEEPSEEK_JSON';
  throw err;
}

function createClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const err = new Error('DeepSeek API key not configured (DEEPSEEK_API_KEY)');
    err.code = 'DEEPSEEK_MISSING_KEY';
    throw err;
  }
  return new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL, timeout: DEEPSEEK_TIMEOUT_MS });
}

function normalizeUpstreamError(err, fallbackLabel) {
  const status = err.status || (err.response && err.response.status) || 500;
  const rateLimited = status === 429 || /rate limit/i.test(err.message || '');
  const quota = /quota|insufficient/i.test(err.message || '') && status === 402;
  const e = new Error(rateLimited
    ? 'AI rate limit exceeded. Please try again shortly.'
    : quota
      ? 'AI quota exceeded.'
      : `${fallbackLabel}: ${err.message}`);
  e.status = status;
  e.code = rateLimited ? 'DEEPSEEK_RATE_LIMITED' : quota ? 'DEEPSEEK_QUOTA' : 'DEEPSEEK_ERROR';
  e.cause = err;
  throw e;
}

/**
 * Extract a structured candidate profile from raw resume text.
 * @param {string} rawText - plain text extracted from a resume PDF
 * @returns {Promise<object>} structured profile object (see PROFILE_EXTRACTION_SYSTEM_PROMPT schema)
 */
async function extractProfileFromResume(rawText) {
  const client = createClient();
  const messages = [
    { role: 'system', content: PROFILE_EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: `Resume text:\n\n${String(rawText || '').slice(0, 20000)}` }
  ];

  let content = '';
  try {
    const response = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.1,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      timeout: DEEPSEEK_TIMEOUT_MS
    });
    content = (response.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      const err = new Error('DeepSeek returned an empty profile extraction');
      err.code = 'DEEPSEEK_EMPTY';
      throw err;
    }
    return parseJsonFromText(content);
  } catch (err) {
    console.error('[DEEPSEEK API ERROR]:', err.stack || err.message || err);
    if (err.code === 'DEEPSEEK_JSON' || err.code === 'DEEPSEEK_EMPTY') {
      console.warn('[DEEPSEEK PARSE] Profile extraction JSON was not recoverable.', {
        snippet: String(content || '').slice(0, 200)
      });
      throw err;
    }
    normalizeUpstreamError(err, 'Profile extraction failed');
  }
}

/**
 * Batch-evaluate candidate profiles against a job in a single LLM call.
 *
 * The prompt payload is structured into two explicit sections:
 *   1. JOB ANALYSIS — job title, core role category, required skills, description.
 *   2. CANDIDATE LIST — full structured profile breakdown per candidate.
 *
 * @param {string} jobTitle
 * @param {string} jobDescription
 * @param {Array<object>} profiles - CandidateProfile documents (lean ok)
 * @param {object} [options]
 * @param {string} [options.coreRoleCategory] - inferred core role category (e.g., "Fullstack Web")
 * @param {Array<string>} [options.requiredSkills] - skills named in the job posting
 * @param {object} [options.client] - OpenAI-compatible client override (used for tests)
 * @returns {Promise<Array<{profileId, profileName, score, coreRoleMatch, criteriaScores, reasoning}>>}
 */
async function evaluateProfilesForJob(jobTitle, jobDescription, profiles, options = {}) {
  const { coreRoleCategory = 'General', requiredSkills = [], client } = options;
  const llm = client || createClient();

  console.log('[DEEPSEEK SCORE START] Evaluating job:', jobTitle, 'with', profiles.length, 'candidates');

  const candidatePayload = (profiles || []).map((p) => ({
    _id: String(p._id),
    name: p.name || 'Unknown',
    professionalTitle: p.professionalTitle || '',
    yearsOfExperience: p.yearsOfExperience ?? null,
    primarySkills: (p.primarySkills || []).slice(0, 8),
    secondarySkills: (p.secondarySkills || []).slice(0, 5),
    employmentHistory: (p.employmentHistory || []).map((e) => ({
      title: e.title || '',
      company: e.company || '',
      description: e.description || ''
    })),
    projectExperience: (p.projectExperience || []).slice(0, 5).map((pr) => ({
      title: pr.title || '',
      description: pr.description || '',
      technologies: (pr.technologies || []).slice(0, 5)
    }))
  }));

  const jobAnalysis = [
    'JOB ANALYSIS:',
    `Job Title: ${jobTitle || 'Not provided'}`,
    `Core Role Category: ${coreRoleCategory || 'General'}`,
    `Required Skills: ${Array.isArray(requiredSkills) && requiredSkills.length ? requiredSkills.join(', ') : 'Not specified'}`,
    '',
    'Full Job Description:',
    String(jobDescription || '').slice(0, MAX_DESCRIPTION_CHARS)
  ].join('\n');

  /**
   * Evaluate a single candidate against the job via DeepSeek.
   * Returns the parsed score entry or null on parse/empty failure (caller
   * falls back to deterministic scoring for this candidate).
   *
   * @param {object} singlePayload — one candidate's compact profile
   * @returns {Promise<object|null>}
   */
  async function evaluateSingleCandidate(singlePayload) {
    const singleList = [
      `CANDIDATE LIST (1 candidate — return exactly 1 score entry):`,
      `IMPORTANT: Use the "_id" field below as the "profileId" in your output. It MUST exactly match "${singlePayload._id}" — do not modify, re-encode, or reformat it in any way.`,
      JSON.stringify(singlePayload, null, 2)
    ].join('\n');

    const messages = [
      { role: 'system', content: PROFILE_SCORING_SYSTEM_PROMPT },
      { role: 'user', content: [jobAnalysis, '', singleList].join('\n') }
    ];

    let response;
    try {
      response = await llm.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 8192,
        response_format: { type: 'json_object' },
        timeout: DEEPSEEK_TIMEOUT_MS
      });
    } catch (err) {
      console.error('[DEEPSEEK API ERROR]', err.stack || err.message || err);
      if (err.code === 'DEEPSEEK_JSON' || err.code === 'DEEPSEEK_EMPTY') throw err;
      normalizeUpstreamError(err, 'Profile scoring failed');
    }

    let content = '';
    let parsed;
    try {
      content = (response.choices?.[0]?.message?.content || '').trim();
      if (!content) {
        const err = new Error('DeepSeek returned an empty profile evaluation');
        err.code = 'DEEPSEEK_EMPTY';
        throw err;
      }
      parsed = parseJsonFromText(content);
    } catch (err) {
      console.error('[DEEPSEEK API ERROR]', err.stack || err.message || err);
      if (err.code === 'DEEPSEEK_JSON' || err.code === 'DEEPSEEK_EMPTY') {
        console.warn('[DEEPSEEK PARSE] Single-candidate evaluation JSON unrecoverable; candidate will use fallback scoring.', {
          profileId: singlePayload._id,
          snippet: String(content || '').slice(0, 200)
        });
        return null;
      }
      normalizeUpstreamError(err, 'Profile scoring failed');
    }

    const rawResults = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.scores) ? parsed.scores : []);
    if (!rawResults.length) return null;

    // For single-candidate batches, take the first valid entry.
    // Use the exact profileId if present; otherwise trust the name-keyed fallback.
    const nameKey = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const exact = rawResults.find(
      (r) => r && String(r.profileId || '') === String(singlePayload._id)
    );
    if (exact) {
      console.log('[DEEPSEEK RAW SCORES]', JSON.stringify([exact]));
      return { ...exact, _resolvedId: singlePayload._id };
    }
    const nameMatch = rawResults.find(
      (r) => r && r.profileName && nameKey(r.profileName) === nameKey(singlePayload.name)
    );
    if (nameMatch) {
      console.log('[DEEPSEEK RAW SCORES]', JSON.stringify([nameMatch]));
      return { ...nameMatch, _resolvedId: singlePayload._id };
    }
    console.log('[DEEPSEEK RAW SCORES]', JSON.stringify([rawResults[0]]));
    return { ...rawResults[0], _resolvedId: singlePayload._id };
  }

  // Micro-batch: evaluate candidates ONE AT A TIME so output truncation can never
  // drop candidates 4-8. Each call gets the full job description as context.
  // Fallback scoring covers any candidate whose DeepSeek call fails.
  const results = [];
  for (const singlePayload of candidatePayload) {
    // eslint-disable-next-line no-await-in-loop
    const result = await evaluateSingleCandidate(singlePayload);
    results.push(result);
  }

  // Log raw scores for each candidate immediately after receipt.
  // (Already logged inside evaluateSingleCandidate per call.)

  const rawResults = results
    .filter(Boolean)
    .map((r) => {
      // Coerce score fields to numbers.
      const entry = { ...r };
      if (entry.score != null && entry.score !== '') {
        const s = Number(entry.score);
        if (Number.isFinite(s)) entry.score = s;
      }
      if (entry.criteriaScores && typeof entry.criteriaScores === 'object') {
        for (const k of Object.keys(entry.criteriaScores)) {
          const v = entry.criteriaScores[k];
          if (v != null && v !== '') {
            const parsed = Number(v);
            if (Number.isFinite(parsed)) entry.criteriaScores[k] = parsed;
          }
        }
      }
      return entry;
    });

  const scoredCount = rawResults.length;
  const totalCount = candidatePayload.length;
  console.log('[DEEPSEEK SCORE] Scored', scoredCount, '/', totalCount, 'candidates via DeepSeek');
  return rawResults;
}

/**
 * Generate a cover letter for a job.
 * @param {object} job - LinkedinJob document (or plain object)
 * @param {object} brand - Brand document (optional, for company fallback)
 * @param {string} [additionalInstructions]
 * @param {object} [candidateProfile] - optional CandidateProfile used as the
 *   strict ground-truth source for the applicant's qualifications
 * @returns {Promise<string>} the generated cover letter text
 * @throws {Error} with a `status`-like code if API key missing or generation fails
 */
async function generateCoverLetter(job, brand = {}, additionalInstructions, candidateProfile) {
  const client = createClient();

  const messages = [
    { role: 'system', content: COVER_LETTER_SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(job, brand, additionalInstructions, candidateProfile) }
  ];

  try {
    const response = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1200,
      timeout: DEEPSEEK_TIMEOUT_MS
    });

    const content = (response.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      const err = new Error('DeepSeek returned an empty cover letter');
      err.code = 'DEEPSEEK_EMPTY';
      throw err;
    }
    return content;
  } catch (err) {
    console.error('[DEEPSEEK API ERROR]:', err.stack || err.message || err);
    if (err.code === 'DEEPSEEK_EMPTY') throw err;
    normalizeUpstreamError(err, 'Cover letter generation failed');
  }
}

module.exports = { generateCoverLetter, extractProfileFromResume, evaluateProfilesForJob, parseJsonFromText, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL };
