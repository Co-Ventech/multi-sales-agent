/**
 * Company Name Extractor for Upwork Jobs
 * Reads upwork.jobs.json and extracts real company names from descriptions.
 *
 * Strategy: Multiple targeted patterns ordered by confidence, not one fragile regex.
 */

const fs = require('fs');
const path = require('path');

const JOBS_FILE = path.join(__dirname, '..', 'upwork.jobs.json');

// ─── Patterns ────────────────────────────────────────────────────────────────
// Each entry: { label, regex, group, confidence, source }
// 'source' = 'description' (default) | 'title'
// 'group'  = capture group index that holds the company name
const PATTERNS = [
  // ── HIGH confidence ──────────────────────────────────────────────────────

  // "Company:\nTicket Trust" / "Company: Acme Software"
  {
    label: 'Company: label',
    regex: /Company:\s*\n?\s*([A-Z][A-Za-z0-9 &.,'-]{2,50}?)(?:\s*[\n\(]|$)/gm,
    group: 1,
    confidence: 'HIGH',
  },
  // "We at Revelio Labs are" / "We at XYZ are seeking"
  {
    label: 'We at <Company>',
    regex: /\bWe at ([A-Z][A-Za-z0-9 &.,'-]{2,50}?) (?:are|is)\b/g,
    group: 1,
    confidence: 'HIGH',
  },
  // "<Company> is a <type> company" at start of sentence
  {
    label: '<Company> is a … company',
    regex: /(?:^|\n)([A-Z][A-Za-z0-9 &.,'-]{2,50}?) is (?:a |an )(?:[a-z]+ ){0,4}company/gm,
    group: 1,
    confidence: 'HIGH',
  },
  // "About <Company>" — very common Upwork section header
  {
    label: 'About <Company>',
    regex: /(?:^|\n)About ([A-Z][A-Za-z0-9 &.,'-]{2,50}?)\s*\n/gm,
    group: 1,
    confidence: 'HIGH',
  },
  // "<Company> is a … platform/tool/startup/agency/team/marketplace/leader…" broader
  {
    label: '<Company> is a … product/platform/team',
    regex: /(?:^|\n)([A-Z][A-Za-z0-9 &.,'-]{2,50}?) is (?:a |an )(?:[a-z]+ ){0,5}(?:platform|tool|startup|agency|service|system|solution|app|SaaS|software|technology|firm|studio|team|group|leader|pioneer|provider|creator|maker|developer|marketplace|network|community|brand|product|suite)/gm,
    group: 1,
    confidence: 'HIGH',
  },
  // "<Company> is looking for / is hiring / is seeking …"  (very common Upwork opener)
  {
    label: '<Company> is looking/hiring/seeking',
    regex: /(?:^|\n)([A-Z][A-Za-z0-9 &.,'-]{2,50}?) is (?:currently )?(?:looking|hiring|seeking|searching|recruiting)\b/gm,
    group: 1,
    confidence: 'HIGH',
  },
  // "<Company> is developing / is building / is creating …"
  {
    label: '<Company> is developing/building',
    regex: /(?:^|\n)([A-Z][A-Za-z0-9 &.,'-]{2,50}?) is (?:developing|building|creating|launching|powering|enabling|transforming|reimagining|revolutionizing)\b/gm,
    group: 1,
    confidence: 'HIGH',
  },
  // Job title ends with " — CompanyName" or " - CompanyName"  e.g. "Bug Fix - Expensify"
  // Requires SPACE before dash (rules out compound words like "Mission-Driven")
  // Allows optional closing ) or ] after name (e.g. "Leader – Nesavelle)")
  // Strict: 1-3 words, each starting with capital, no generic descriptors
  {
    label: 'Title ends with — <Company>',
    regex: /\s[-—–]\s+([A-Z][A-Za-z0-9]{1,20}(?:\s[A-Z][A-Za-z0-9]{1,20}){0,2})\s*[)\]]?\s*$/gm,
    group: 1,
    confidence: 'HIGH',
    source: 'title',
  },

  // ── MEDIUM confidence ─────────────────────────────────────────────────────

  // "for Burnsed Trucking to manage" — "for <Company> to"
  {
    label: 'for <Company> to',
    regex: /\bfor ([A-Z][A-Za-z0-9 &.,'-]{2,50}?) to (?:manage|build|help|support|create|develop|run|automate|track|handle|process|deliver|launch|scale)/g,
    group: 1,
    confidence: 'MEDIUM',
  },
  // "at <Company>, we" or "at <Company> we"
  {
    label: 'at <Company>, we',
    regex: /\bAt ([A-Z][A-Za-z0-9 &.,'-]{2,50?}?),? we\b/g,
    group: 1,
    confidence: 'MEDIUM',
  },
  // "at <Company>, you" — "As a Software Engineer at Imajine, you will…"
  {
    label: 'at <Company>, you',
    regex: /\bat ([A-Z][A-Za-z0-9 &.,'-]{2,50?}?),\s+you\b/g,
    group: 1,
    confidence: 'MEDIUM',
  },
  // "role at <Company>" / "position at <Company>" — case-insensitive for role word
  {
    label: 'role/position at <Company>',
    regex: /\b(?:role|position|job|engineer|developer|manager|director|specialist|analyst)\s+at\s+([A-Z][A-Za-z0-9 &.,'-]{2,50}?)[,.\s]/gi,
    group: 1,
    confidence: 'MEDIUM',
  },
  // "<Company> (companysite.com)" — company name right before a URL in parens
  {
    label: '<Company> (url)',
    regex: /([A-Z][A-Za-z0-9 &.,'-]{1,40}?) \((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\)]*)?\)/g,
    group: 1,
    confidence: 'MEDIUM',
  },
  // "Project Overview … for <Company>" / "Setup for <Company>"
  {
    label: 'Setup/Overview for <Company>',
    regex: /\b(?:Setup|Overview|System) for ([A-Z][A-Za-z0-9 &.,'-]{2,50}?)[\n\r]/g,
    group: 1,
    confidence: 'MEDIUM',
  },
  // "github.com/CompanyName/" — GitHub org name is often company name
  {
    label: 'github.com/<Company>',
    regex: /github\.com\/([A-Z][A-Za-z0-9-]{2,40})\//g,
    group: 1,
    confidence: 'MEDIUM',
  },

  // ── LOW confidence ────────────────────────────────────────────────────────

  // "Join/joining <Company> as/to/and"
  {
    label: 'Join <Company>',
    regex: /\b(?:Join|joining) ([A-Z][A-Za-z0-9 &.,'-]{2,50}?) (?:as|to|and)\b/g,
    group: 1,
    confidence: 'LOW',
  },
];

// ─── Stopwords — things that look like company names but aren't ──────────────
const STOPWORDS = new Set([
  'We', 'Our', 'The', 'This', 'Your', 'Their', 'His', 'Her', 'Its',
  'United States', 'United Kingdom', 'US', 'UK', 'USA', 'API', 'AI',
  'Google', 'Amazon', 'Microsoft', 'LinkedIn', 'Facebook', 'Twitter',
  'eBay', 'Amazon', 'Home Depot', 'Dropbox', 'Stripe', 'OpenAI', 'Anthropic',
  'Claude', 'ChatGPT', 'GPT', 'Python', 'JavaScript', 'Node', 'React',
  'Zapier', 'HubSpot', 'Apollo', 'Airtable', 'Slack', 'Calendly',
  'Workday', 'Greenhouse', 'Paycor', 'Salesforce', 'Shopify',
  'Playwright', 'Puppeteer', 'Docker', 'Redis', 'PostgreSQL',
  'Make', 'Clay', 'Procore', 'BrokerBay', 'ShowingTime',
  'Klaviyo', 'Mailchimp', 'Instantly', 'SmartLead',
  'Note', 'Important', 'Phase', 'Step', 'Goal', 'Scope', 'Budget',
  'Overview', 'Summary', 'Description', 'Milestone', 'Deliverable',
  'Company', 'Position', 'Location', 'Requirements', 'Responsibilities',
  'Project', 'Role', 'Team', 'About', 'Ideal', 'Candidate',
  'Workday', 'ADP', 'UKG', 'UltiPro', 'iCIMS', 'BambooHR',
  'YouTube', 'Instagram', 'TikTok', 'Skool',
  'WooCommerce', 'Shopify', 'WordPress', 'Figma', 'ShipStation',
  'Algolia', 'Searchanise', 'Alpine', 'Tailwind', 'Bootstrap',
  'GitHub', 'Docker', 'ReactNative', 'React', 'Stripe',
  'Craft', 'Yii', 'Liquid', 'SQL', 'PHP',
  // Generic descriptor words that appear after "—" in titles
  'Integration', 'Platform', 'Solution', 'Development', 'Migration',
  'Optimization', 'Management', 'Implementation', 'Commerce', 'Driven',
  'Required', 'Needed', 'Expert', 'Specialist', 'Manager', 'Engineer',
]);

function isStopword(name) {
  const trimmed = name.trim();
  // Exact match in stopwords
  if (STOPWORDS.has(trimmed)) return true;
  // All caps abbreviation ≤ 5 chars (like "AI", "SaaS", "CRM")
  if (/^[A-Z]{1,5}$/.test(trimmed)) return true;
  // Starts with lowercase (shouldn't happen due to regex, safety check)
  if (/^[a-z]/.test(trimmed)) return true;
  // Pure numbers
  if (/^\d+$/.test(trimmed)) return true;
  return false;
}

// ─── Main extraction ─────────────────────────────────────────────────────────
function extractCompanies(jobs) {
  const results = [];

  for (const job of jobs) {
    const description = job.description || '';
    const title       = job.title       || '';
    const foundInThisJob = new Map(); // name → best match info

    for (const pattern of PATTERNS) {
      // 'title' patterns scan the job title; all others scan description
      const text = (pattern.source === 'title') ? title : description;
      if (!text) continue;

      const re = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = re.exec(text)) !== null) {
        const raw = match[pattern.group];
        if (!raw) continue;

        const name = raw.trim().replace(/\s+/g, ' ');

        // Basic length filter
        if (name.length < 3 || name.length > 55) continue;
        if (isStopword(name)) continue;

        // Prefer highest confidence match for this name in this job
        const existing = foundInThisJob.get(name);
        if (!existing || confidenceRank(pattern.confidence) > confidenceRank(existing.confidence)) {
          foundInThisJob.set(name, {
            company: name,
            confidence: pattern.confidence,
            pattern: pattern.label,
            jobId: job.id,
            jobTitle: job.title,
            context: match[0].trim().slice(0, 120),
          });
        }
      }
    }

    for (const info of foundInThisJob.values()) {
      results.push(info);
    }
  }

  return results;
}

function confidenceRank(c) {
  return c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : 1;
}

// ─── De-duplicate across all jobs ────────────────────────────────────────────
function dedup(results) {
  const map = new Map();
  for (const r of results) {
    const key = r.company.toLowerCase();
    const existing = map.get(key);
    if (!existing || confidenceRank(r.confidence) > confidenceRank(existing.confidence)) {
      map.set(key, { ...r, occurrences: (existing?.occurrences || 0) + 1 });
    } else {
      existing.occurrences = (existing.occurrences || 1) + 1;
    }
  }
  return [...map.values()].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
}

// ─── Run ─────────────────────────────────────────────────────────────────────
const raw = fs.readFileSync(JOBS_FILE, 'utf-8');
const jobs = JSON.parse(raw);

const extracted = extractCompanies(jobs);
const deduped = dedup(extracted);

console.log('\n═══════════════════════════════════════════════════════');
console.log('   COMPANY NAMES FOUND IN UPWORK JOB DESCRIPTIONS');
console.log('═══════════════════════════════════════════════════════\n');

for (const r of deduped) {
  console.log(`  Company   : ${r.company}`);
  console.log(`  Confidence: ${r.confidence}`);
  console.log(`  Pattern   : ${r.pattern}`);
  console.log(`  Job Title : ${r.jobTitle}`);
  console.log(`  Context   : "${r.context}"`);
  console.log('  ─────────────────────────────────────────────────────');
}

console.log(`\nTotal unique companies found: ${deduped.length}`);

// Also save to JSON
const outPath = path.join(__dirname, 'company_names.json');
fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
console.log(`\nSaved to: ${outPath}`);
