/**
 * Co-Ventech email prompt templates
 * Each industry maps to a specific pain point and case study reference
 */

// Case studies sourced directly from co-ventech.com/case-studies
const INDUSTRY_PAIN_POINTS = {
  fintech: {
    pain:      'outdated encryption and manual compliance processes creating regulatory risk and breach exposure',
    solution:  'automated security testing, compliance automation, and encryption upgrade across all payment channels',
    caseStudy: 'Bluefin (global payment security, 60+ countries) — 99% reduction in data breaches, doubled platform capacity, 60% faster compliance reporting, zero downtime during implementation',
    audience:  'engineering and QA leads at fintech and payment companies'
  },
  cybersecurity: {
    pain:      'legacy architecture exposing payment channels to modern threats with inconsistent data protection globally',
    solution:  'next-gen encryption upgrade, vulnerability remediation, and disaster recovery protocols',
    caseStudy: 'Bluefin — 99% breach reduction, doubled capacity, 60% faster compliance cycles with zero service disruption',
    audience:  'security engineering and infrastructure leads'
  },
  healthcare: {
    pain:      'HIPAA-sensitive release risks and data integrity issues in clinical workflows under compliance pressure',
    solution:  'end-to-end security and functional testing for healthcare platforms with compliance automation',
    caseStudy: 'Bluefin — our compliance automation approach cut reporting time by 60% and eliminated breach incidents entirely',
    audience:  'engineering leads at health-tech and medical software companies'
  },
  saas: {
    pain:      'slow release cycles from manual regression testing and no CI/CD test coverage causing production bugs',
    solution:  'automated regression suites integrated into your CI/CD pipeline (Selenium/Cypress/Playwright) plus DevOps automation',
    caseStudy: 'RawCaster (social media platform) — 30% faster response times, 25% less downtime, 15% higher user satisfaction. Also reduced IT infrastructure costs by 20% for another client via VAPT + DevOps automation',
    audience:  'engineering and product leads at SaaS companies'
  },
  logistics: {
    pain:      'mobile app crashes, real-time tracking failures, and security vulnerabilities in high-volume ride/delivery operations',
    solution:  'mobile automation (Appium), penetration testing, and real-time monitoring for logistics and mobility apps',
    caseStudy: 'Bykea (Pakistan\'s leading mobility platform, similar scale to Careem) — 50% faster ride booking, 30% lower operational costs, all security vulnerabilities patched',
    audience:  'tech leads at logistics, mobility, and supply chain companies'
  },
  ecommerce: {
    pain:      'payment flow bugs, cart abandonment from performance issues, and downtime during peak traffic',
    solution:  'E2E checkout testing, load/stress testing, and real-time performance monitoring',
    caseStudy: 'RawCaster — our load testing and platform optimization delivered 30% faster response and 25% reduction in downtime',
    audience:  'engineering leads at e-commerce and retail tech companies'
  },
  social: {
    pain:      'latency spikes and server bottlenecks during high traffic killing user retention',
    solution:  'load testing, server log analysis, and scalability optimization for high-traffic platforms',
    caseStudy: 'RawCaster (social media platform) — 30% faster response, 25% less downtime, 15% higher user satisfaction scores',
    audience:  'engineering leads at social media and consumer platforms'
  },
  education: {
    pain:      'platform downtime during enrollment peaks, accessibility compliance gaps, and slow feature releases under academic deadlines',
    solution:  'E2E testing for LMS platforms, load testing for enrollment spikes, and CI/CD automation for faster releases',
    caseStudy: 'RawCaster — our load testing and scalability optimization delivered 30% faster response times and zero downtime during traffic surges',
    audience:  'engineering and product leads at edtech and education platforms'
  },
  telecom: {
    pain:      'network service reliability under scale, slow feature deployment across legacy systems, and security compliance risks',
    solution:  'performance testing, API testing for telecom services, security audits, and CI/CD pipeline automation',
    caseStudy: 'Bluefin — our security testing and compliance automation cut compliance reporting by 60% with zero service disruption',
    audience:  'engineering leads at telecom and network companies'
  },
  automotive: {
    pain:      'connected vehicle app instability, IoT integration testing gaps, and safety-critical software release risks',
    solution:  'mobile and IoT automation testing (Appium, Selenium), performance testing, and security vulnerability assessments',
    caseStudy: 'Bykea — our full-stack automation and security testing delivered 50% faster operations and patched all security vulnerabilities',
    audience:  'engineering leads at automotive tech and connected vehicle companies'
  },
  insurance: {
    pain:      'claims processing bugs, regulatory compliance overhead, and legacy system migration risks',
    solution:  'regression automation for policy/claims workflows, compliance testing, and secure migration testing',
    caseStudy: 'Bluefin (fintech/payments) — our compliance automation cut reporting time by 60% while achieving 99% reduction in security incidents',
    audience:  'IT and engineering leads at insurance and insurtech companies'
  },
  consulting: {
    pain:      'client-facing portal instability, slow delivery cycles across multiple projects, and data security for sensitive client data',
    solution:  'QA automation across web/mobile portals, CI/CD pipeline setup, and penetration testing for client data protection',
    caseStudy: 'Bluefin — 99% breach reduction and doubled platform capacity; RawCaster — 30% faster response times with zero downtime',
    audience:  'technology leads at consulting and professional services firms'
  },
  default: {
    pain:      'slow releases, high defect rates in production, and security vulnerabilities discovered too late',
    solution:  'end-to-end QA automation (Selenium, Cypress, Playwright), security testing, and CI/CD integration tailored to your stack',
    caseStudy: 'Bluefin (99% breach reduction, 60% faster compliance), Bykea (50% faster operations, 30% cost reduction), RawCaster (30% faster response, 25% less downtime)',
    audience:  'engineering and product teams'
  }
};

function getIndustryContext(industry = '') {
  const lower = industry.toLowerCase();
  if (lower.includes('financ') || lower.includes('fintech') || lower.includes('bank'))   return INDUSTRY_PAIN_POINTS.fintech;
  if (lower.includes('health') || lower.includes('medical') || lower.includes('clinic')) return INDUSTRY_PAIN_POINTS.healthcare;
  if (lower.includes('saas') || lower.includes('software') || lower.includes('internet'))return INDUSTRY_PAIN_POINTS.saas;
  if (lower.includes('logistic') || lower.includes('transport') || lower.includes('supply') || lower.includes('mobility') || lower.includes('delivery')) return INDUSTRY_PAIN_POINTS.logistics;
  if (lower.includes('retail') || lower.includes('e-commerce') || lower.includes('ecommerce')) return INDUSTRY_PAIN_POINTS.ecommerce;
  if (lower.includes('social') || lower.includes('media') || lower.includes('platform') || lower.includes('community')) return INDUSTRY_PAIN_POINTS.social;
  if (lower.includes('cyber') || lower.includes('security') || lower.includes('infosec')) return INDUSTRY_PAIN_POINTS.cybersecurity;
  if (lower.includes('educ') || lower.includes('e-learning') || lower.includes('learning')) return INDUSTRY_PAIN_POINTS.education;
  if (lower.includes('telecom') || lower.includes('wireless') || lower.includes('network'))  return INDUSTRY_PAIN_POINTS.telecom;
  if (lower.includes('auto') || lower.includes('vehicle') || lower.includes('motor'))        return INDUSTRY_PAIN_POINTS.automotive;
  if (lower.includes('insur'))                                                                return INDUSTRY_PAIN_POINTS.insurance;
  if (lower.includes('consult') || lower.includes('professional') || lower.includes('staff')) return INDUSTRY_PAIN_POINTS.consulting;
  if (lower.includes('information technology') || lower.includes('it service') || lower.includes('managed service')) return INDUSTRY_PAIN_POINTS.saas;
  return INDUSTRY_PAIN_POINTS.default;
}

/**
 * Build the OpenAI prompt for a cold email
 *
 * Signal-based selling principles (from outbound research):
 * - Subject: 3-5 words, all lowercase, looks like an internal email thread
 * - Opening: reference a specific observable signal (tech stack, hiring, industry trend)
 * - Value prop: one sentence in the buyer's language — numbers beat adjectives
 * - Social proof: one line citing a relevant case study (only if genuinely relevant)
 * - CTA: single, soft, low-friction yes/no question
 */
function buildEmailPrompt(contact, companyName, emailConfig = {}) {
  // Support both snake_case (Apify/import) and camelCase (MongoDB .toObject())
  const name     = contact.first_name  || contact.firstName  || 'there';
  const lastName = contact.last_name   || contact.lastName   || '';
  const fullName = contact.full_name   || contact.fullName   || [name, lastName].filter(Boolean).join(' ').trim() || name;
  const title    = contact.job_title   || contact.jobTitle   || 'engineering leader';
  const company  = contact.company_name || contact.companyName || 'your company';
  const industry = contact.industry    || '';
  const rawTech  = contact.technology_stack || contact.technologyStack || [];
  const techArr  = Array.isArray(rawTech) ? rawTech : String(rawTech).split(',').map(t => t.trim()).filter(Boolean);
  const tech     = techArr.slice(0, 5).join(', ') || '';
  const ctx      = getIndustryContext(industry);
  const calendlyUrl = emailConfig.calendlyUrl || '';

  // MINIMAL mode — when the caller uses a custom system prompt (e.g. A/B
  // variant prompts or a user-defined main prompt), do NOT inject a
  // structure/rules user-message. Just hand the AI the contact data and let
  // the SYSTEM PROMPT fully control format, tone, CTA, and case studies.
  // This stops the preview from ignoring whatever prompt the user wrote.
  if (emailConfig.minimal) {
    const lines = [
      `Write a cold email for the following prospect:`,
      ``,
      `- First name: ${name}`,
      `- Full name: ${fullName}`,
      `- Title: ${title}`,
      `- Company: ${company}`,
      industry ? `- Industry: ${industry}` : null,
      tech ? `- Tech stack: ${tech}` : null,
      contact.company_description ? `- What they do: ${contact.company_description}` : null,
      contact.company_size ? `- Company size: ${contact.company_size} employees` : null,
      contact.country ? `- Country: ${contact.country}` : null,
      ``,
      `Follow the system prompt's voice and instructions exactly. OUTPUT FORMAT (mandatory — blank lines between every paragraph):`,
      ``,
      `Subject: [subject line]`,
      ``,
      `Hi ${name},`,
      ``,
      `[Paragraph 1]`,
      ``,
      `[Paragraph 2]`,
      ``,
      `[Paragraph 3 — CTA]`,
      ``,
      calendlyUrl
        ? `Include this Calendly link as the CTA on its own line: ${calendlyUrl}`
        : `Do NOT include any URLs or links.`,
      `Do NOT include a signature block (added automatically).`
    ].filter(Boolean);
    return lines.join('\n');
  }

  const tone      = emailConfig.tone      || 'professional';
  const cta       = emailConfig.cta       || 'Worth a 15-minute call?';
  const valueProp = emailConfig.valueProp || ctx.solution;

  // Content skeleton — optional LinkedIn reference hook
  const skeleton = emailConfig.contentSkeleton || {};
  let linkedInHook = '';
  if (skeleton.enabled && skeleton.includeLinkedIn && skeleton.linkedInText) {
    linkedInHook = skeleton.linkedInText
      .replace('{company}', company)
      .replace('{name}', name)
      .replace('{title}', title);
  }

  // Rich prospect context — all available data from Apify
  const companyDesc  = contact.company_description || contact.companyDescription || '';
  const headline     = contact.headline            || '';
  const companySize  = contact.company_size        || contact.companySize || '';
  const revenue      = contact.company_annual_revenue_clean || contact.company_annual_revenue || contact.companyAnnualRevenue || '';
  const funding      = contact.company_total_funding_clean  || contact.companyTotalFunding || '';
  const seniority    = contact.seniority_level     || contact.seniorityLevel || '';
  const website      = contact.company_website     || contact.companyWebsite || contact.company_domain || contact.companyDomain || '';
  const companyLinkedin = contact.company_linkedin || contact.companyLinkedin || '';
  const functionalLevel = contact.functional_level || contact.functionalLevel || '';

  return `Write a signal-based cold outreach email for ${companyName} to a prospect. Tone: ${tone}.

PROSPECT DETAILS (use this data to write a specific, personalised opening — the more specific the better):
- Name: ${name}
- Title: ${title}
- LinkedIn headline: ${headline || 'N/A'}
- Seniority: ${seniority || 'N/A'}
- Function: ${functionalLevel || 'N/A'}
- Company: ${company}
- Company website: ${website || 'N/A'}
- Company LinkedIn: ${companyLinkedin || 'N/A'}
- What they do: ${companyDesc || 'N/A'}
- Industry: ${industry || 'technology'}
- Company size: ${companySize || 'N/A'} employees
- Revenue: ${revenue || 'N/A'}
- Total funding: ${funding || 'N/A'}
- Tech stack: ${tech || 'N/A'}

ABOUT ${companyName.toUpperCase()} (the company sending this email):
- Tagline: AI-Powered Next-Gen Human Innovation
- Website: https://co-ventech.com
- Core services:
  • QA & Test Automation — Selenium, Cypress, Playwright, Appium (E2E, performance, API, security, usability testing)
  • Cybersecurity — VAPT, penetration testing, next-gen encryption, threat detection, compliance automation
  • DevOps & Cloud — CI/CD pipelines (Jenkins, GitHub Actions), Docker, Kubernetes, AWS, Azure
  • Software Development — React, Node.js, Python, TypeScript, Flutter (web, mobile, SaaS, AI apps)
  • Generative AI — GPT/LLMs, TensorFlow, AI content generation, workflow optimisation
  • Mobile App Development — Flutter, React Native, Swift, Kotlin
- Notable clients: Bluefin, Bykea, Careem, CreditBook, VistaJet, Welltech, Gooru, Byzat, Neusol, Upnest, datworks
- 20% average IT infrastructure cost reduction via VAPT + DevOps Automation
- Products: Recruitinn (hiring), Skillbuilder (training), Covental
- Talent Marketplace: top 1% pre-vetted engineers (AI, frontend, backend, QA, VAPT)

REAL CASE STUDIES (ONLY reference these — NEVER invent or fabricate):
1. Bluefin (Payment Security, 60+ countries) — 99% breach reduction, doubled platform capacity, 60% faster compliance, zero downtime. CEO quote: "Co-Ventech has exceeded all our expectations."
2. Bykea (Mobility/Logistics, Pakistan) — 50% faster ride-booking, 30% lower operational costs, all security vulnerabilities patched, full compliance.
3. RawCaster (Social Media Platform) — 30% faster response times, 25% less downtime, 15% higher user satisfaction, seamless scalability.

CONTEXT FOR THIS PROSPECT:
- Their likely pain: ${ctx.pain}
- What ${companyName} solves: ${valueProp}
- Best matching case study for their industry: ${ctx.caseStudy}

STRICT RULES — VIOLATIONS WILL MAKE THIS EMAIL USELESS:
1. Subject: 3-6 words, sentence case, must reference ${company} or ${name}'s actual role — NOT a generic topic
2. Paragraph 1 (1 sentence only): Name one SPECIFIC thing about ${company} — their product, their tech stack (${tech || 'see above'}), their size, their market. If nothing specific is available, reference ${title} at a ${companySize || 'growing'}-person company. NEVER say "making waves", "evolving landscape", "navigating challenges" or any vague phrase.
3. Paragraph 2 (1 sentence only): One case study result with exact numbers. Example: "We helped Bykea cut ride-booking time by 50% and operational costs by 30%."
4. Paragraph 3 (1-2 sentences): "${cta}" — nothing else, no URL, no link
5. Start with "Hi ${name}," — blank line — then paragraph 1
6. NO sign-off, NO signature block, NO hyphens, NO URLs
7. BANNED phrases (instant rejection): "making waves", "interesting to see", "navigating", "evolving landscape", "face hurdles", "common theme", "hope this finds", "just checking in", "reaching out", "touching base", "I wanted to", "I noticed that companies"
8. Total body: under 75 words. Count them.

OUTPUT FORMAT:
Subject: [subject]

Hi ${name},

[Paragraph 1 — specific fact about ${company} or ${name}'s role]

[Paragraph 2 — case study with numbers]

[Paragraph 3 — CTA question]`;
}

/**
 * Build follow-up prompt (emails 2, 3 in the sequence)
 *
 * Each touch must add a NEW value angle — not repeat the same ask.
 * Rule: never send "just checking in" — each follow-up earns its place.
 */
function buildFollowUpPrompt(contact, followUpNumber, companyName, brand) {
  const name    = contact.first_name  || contact.firstName  || contact.fullName || 'there';
  const company = contact.company_name || contact.companyName || 'your company';

  // If brand has a custom follow-up prompt, use it (soft, generic, customizable)
  if (brand && brand.campaign && brand.campaign.followUpPrompt) {
    return `Write a follow-up email for ${companyName}'s outreach to ${name} at ${company}.

Original email context: We already sent an initial outreach email and the recipient has not replied.

CUSTOM INSTRUCTIONS (follow strictly):
${brand.campaign.followUpPrompt}

HARD RULES:
- Never use em-dashes or en-dashes. Use regular hyphens (-) or commas.
- Greeting: "Hi ${name}," only.
- Do NOT include a signature block (system adds it).
- Stop after the body. End with "Best,"
- Tone must be polite, NOT pushy, NOT salesy, NOT guilt-tripping.

🚫 FORBIDDEN PHRASES (these trigger spam filters — DO NOT use any of them):
- "I hope this email finds you well", "I hope this finds you well", "Hope you're doing well"
- "Just following up", "Just checking in", "Touching base", "Circling back"
- "Per my last email", "As I mentioned"
- "Act now", "Limited time", "Don't miss", "Don't hesitate", "Don't delay"
- "Click here", "Click below", "Buy now", "Subscribe now"
- "Risk free", "No risk", "Free money", "Cash bonus"
- "Congratulations", "You've been selected", "Dear friend"
- ANY phrase from the spam blocklist; write fresh, specific, conversational openings instead.

GOOD opening alternatives (pick a different angle each time):
- "Quick note re: my earlier email about ${company}..."
- "Wanted to surface this once more in case it slipped past..."
- "Following the thread of my note last week..."
- "Saw your team is working on X — figured this is worth one more nudge..."

OUTPUT FORMAT:
Subject: [subject line]

Hi ${name},

[Body with blank lines between paragraphs — start with a fresh opening, NOT a forbidden phrase]

Best,`;
  }

  const ctx     = getIndustryContext(contact.industry || '');

  const angles = {
    1: `Day 3 bump. Different angle from the first email — share ONE specific data point or industry stat that shows the cost of the problem (e.g. "companies in ${contact.industry || 'your space'} lose X hours per release to manual regression"). Reference ${ctx.caseStudy} only if not already mentioned. End with yes/no question.`,
    2: `Day 7 value add. New angle entirely — offer a concrete resource or insight (e.g. a checklist, a common mistake in their stack, or a risk in their current approach). Connect to ${ctx.solution}. Soft CTA: "Would this be relevant to share with your team?"`,
    3: `Day 14 breakup email. "Closing your file" tone — polite, zero pressure. Acknowledge timing might be off. Leave door open: "If QA automation becomes a priority in the next quarter, I'm here." Under 40 words total.`
  };

  const angle = angles[followUpNumber] || angles[1];

  return `Write follow-up email #${followUpNumber} for Co-Ventech's outreach to ${name} at ${company}.

Previous context: Co-Ventech is a QA & test automation agency. We already sent an initial cold email with no reply.

ANGLE FOR THIS EMAIL: ${angle}

RULES:
- Under 80 words total
- No greetings, no sign-off
- Not pushy — conversational tone
- End with a question
- SEPARATE each sentence or thought with a BLANK LINE — do NOT write everything in one paragraph block

OUTPUT FORMAT (strictly follow — blank lines between each sentence/thought):
Subject: [subject line]

[Opening sentence — one line only]

[Value or insight — one line only]

[Question to close]`;
}

module.exports = { buildEmailPrompt, buildFollowUpPrompt, getIndustryContext };
