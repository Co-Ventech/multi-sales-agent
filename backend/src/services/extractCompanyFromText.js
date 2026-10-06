/**
 * extractCompanyFromText.js
 *
 * Company name extraction from job descriptions / raw text.
 * Strategy: targeted patterns + aggressive noise rejection.
 * Every extractor returns candidates; isGoodCompanyName() acts as the shared gate.
 */

const LINKEDIN_URL_REGEX = /https?:\/\/(www\.)?linkedin\.com\/company\/[a-zA-Z0-9\-_%]+\/?/gi;

// ── Noise rejection lists ───────────────────────────────────────────────────────

/** Common first names — never treat as a company */
const FIRST_NAMES = new Set([
  'james','john','michael','david','robert','william','richard','thomas',
  'charles','daniel','matthew','anthony','mark','paul','andrew','steven',
  'kevin','brian','edward','ronald','timothy','jason','jeffrey','ryan',
  'emma','olivia','sophia','isabella','ava','emily','abigail','elizabeth',
  'mason','ethan','noah','liam','benjamin','oliver','alexander','henry',
  'sebastian','aidan','jacob','muhammad','larry','kim','tom',
  'alex','chris','taylor','jordan','casey','riley','quinn','morgan',
  'dana','jamie','lee','kelly','neil','sunita','ali',
  'abdullah','abigale','max','joseph','chad','an','tiago','angry',
  'therese','umut','colton','fannie','sandi','karina','urbano','antoine',
  'roberto','joe','adam','eric','dean','majid','percy','ron','nicole','jan','rick','felix',
  'joeri','patti','saul','tee','teddy','eli','romeo','ayo','dino','carolyn',
  'tariq','yousef','khalid','mohammed','ahmed','ibrahim','osama','abdullah',
]);

/**
 * Substrings that indicate a job-description fragment, NOT a company.
 * Checked case-insensitively. Covers noise found across 1,200-job batch tests.
 */
const BAD_SUBSTRINGS = new Set([
  // Job description language
  'nice to have','payment','payments',
  'looking for','seeking for','seeking a','project for','need for','help for',
  'looking','seeking','hiring','someone','anyone',
  'requirements','overview','scope of work','timeline','budget',
  'responsibilities','qualifications','skills','experience',
  'key features','design and','build and','develop and','create and',
  'we want','we need','for more','for this',
  // Job role / tech terms
  'freelancer','specialist','consultant','manager','coordinator','assistant',
  'developer','engineer','designer','contractor','expert',
  'chrome','firefox','microsoft edge','opera','safari',
  'figma','sketch','adobe','illustrator','photoshop','canva',
  'loom','docusign','zapier','make','n8n','pipedrive',
  'salesforce','hubspot','intercom','klaviyo','mailchimp',
  'webflow','squarespace','wix','kajabi','wordpress','shopify',
  'woocommerce','bigcommerce','magento','prestashop',
  'react','vue','angular','nextjs','next.js','nodejs','node.js',
  'flutter','swift','kotlin','java','python',
  'ios','android','web app','mobile app',
  'stripe','paypal','braintree','coinbase','btcpay',
  'tagkings','target mvp','mvp delivery','estimated time',
  'loo','linkedin','facebook','twitter','instagram',
  'pagespeed','pages insight','lighthouse','seo audit',
  'amazon web','aws','google cloud','azure',
  'google analytics','ga4','gtm',
  'zillow','redfin','mls','realtor',
  'udemy','teachable','gumroad','coursera',
  'discord','slack','teams','zoom','meet',
  'chatgpt','gpt','openai','claude','gemini','ai','llm',
  // Tool/platform noise
  'spoonacular','falcon','koongo','selenium','django','firebase',
  'bubble','xano','weweb','supabase','botpress',
  'frontend','backend','fullstack','full-stack',
  'northwoodsbitcoin','brainathlete',
  'description:','title job','changes to custom',
  'job overview','project overview','project details','job details',
  'scope of work','this role','role include',
  'team composition','supply chain','inventory manage','legal pages',
  'automatic platform','phase prototype','discovery please','sast, dast',
  'dependency scanning','facebook tiktok','tiktok pinterest','instagram facebook',
  'chrome, firefox','uae central bank','lightning web components',
  'design qa','hand-off support','recruiting',
  'thedragontrip','one organised','also open to future projects',
  'target mvp delivery',
  // Descriptor-heavy phrases
  'about lami architects','about the company','about the project',
  'about the role','job description','role description','project description',
  'service provider','service-provider','built in java',
  'basic seo setup','changes to custom','shopify website',
  'am looking','are looking','is looking','for a skilled','for a senior',
  'for an experienced','looking for an','to a professional',
  'ios and android','ios android','native plugin','mobile application',
  'shopify store','wordpress website','wix website',
  'android service','service-provider',
  // Multi-word tech noise (single words caught separately via TECH_WORDS)
  'shopify app','wordpress site','react native','react js','next js app',
  'vue js','angular js','node js','flutter app','flutter mobile',
  'python script','python django','python flask',
  // Hyphenated noise fragments — must catch BEFORE isGoodCompanyName check
  'mobile-responsive','cross-platform','end-to-end','full-stack',
  'front-end','back-end','world-class','ai-powered','open-source',
  'real-time','full-time','part-time','self-starter','game-changing',
]);

/** Standalone tech words — never a company on their own */
const TECH_WORDS = new Set([
  'shopify','wordpress','wix','squarespace','webflow','magento',
  'woocommerce','bigcommerce','prestashop','kajabi',
  'react','vue','angular','nextjs','nodejs','flutter','swift','kotlin',
  'java','python','golang','rust','c++','c#','ruby','php','laravel',
  'django','flask','fastapi','express','rails','spring',
  'firebase','supabase','xano','weweb','bubble','nocodb',
  'stripe','paypal','braintree','coinbase',
  'hubspot','salesforce','pipedrive','intercom','klaviyo','mailchimp',
  'zapier','make','n8n','docusign','loops','sendgrid',
  'figma','sketch','adobe','illustrator','photoshop','canva','invision',
  'selenium','playwright','cypress','puppeteer',
  'aws','azure','gcp','google cloud','heroku','vercel','netlify',
  'docker','kubernetes','terraform','ansible',
  'mongodb','mysql','postgresql','redis','elasticsearch',
  'graphql','rest','api','sdk','cli',
  'chatgpt','openai','claude','gemini','llm','ai','ml',
  'spoonacular','koongo','falcon','botpress','cal.com','ghost',
  'typeform','trello','asana','notion','slack','discord',
  'algolia','cloudflare','fastly','sendgrid','mailgun',
]);

/** Single generic words that alone don't constitute a company name */
const GENERIC_SINGLE = new Set([
  'company','brand','startup','platform','agency','studio','team',
  'project','app','product','service','business','website','store','portal',
]);

/** Common sentence-starter / descriptor words that prepend company names in job posts */
const DESCRIPTOR_PREFIXES = new Set([
  'about','overview','introduction','project','job','role','position',
  'description','details','scope','responsibilities','requirements',
  'title','summary','note','here\'s','here is',
]);

// ── Core validation ───────────────────────────────────────────────────────────

function isGoodCompanyName(name) {
  if (!name || name.length < 3) return false;
  const lower = name.toLowerCase();
  const words = name.split(/\s+/);

  // Reject all-lowercase words (likely a phrase fragment, not a CamelCase company)
  if (words.length === 1 && name[0] === name[0].toLowerCase() && name[0] !== name[0].toUpperCase()) return false;
  if (words.length > 1 && /^[a-z]/.test(name)) return false;

  // Must start with an uppercase letter
  if (!/[A-Z]/.test(name[0])) return false;

  // Each word must be at least 2 chars
  if (words.some(w => w.length < 2)) return false;

  // Max length 50
  if (name.length > 50) return false;

  // Single word: must be 4+ chars AND not a generic AND not a tech word
  if (words.length === 1) {
    if (name.length < 4) return false;
    if (GENERIC_SINGLE.has(lower)) return false;
    if (TECH_WORDS.has(lower)) return false;
    if (FIRST_NAMES.has(lower)) return false;
    // Single word must be CamelCase
    if (!/[A-Z]/.test(name[0]) || !/[a-z]/.test(name.slice(1))) return false;
    return true;
  }

  // Multi-word: require strong CamelCase on at least half the words
  const camelCount = words.filter(w => /[A-Z]/.test(w) && /[a-z]/.test(w)).length;
  if (camelCount < words.length / 2) return false;

  // All words pass basic checks
  if (words.some(w => FIRST_NAMES.has(w.toLowerCase()))) return false;
  if ([...BAD_SUBSTRINGS].some(bad => lower.includes(bad))) return false;
  if (DESCRIPTOR_PREFIXES.has(lower.split(/\s+/)[0])) return false;

  return true;
}

/** Quick score for ranking candidates */
function score(name) {
  let s = name.length;
  const words = name.split(/\s+/);
  const camelWords = words.filter(w => /[A-Z]/.test(w) && /[a-z]/.test(w)).length;
  s += camelWords * 12;
  if (words.length === 1) s += 5;
  if (words.length === 2) s += 15;
  if (words.length === 3) s += 10;
  if (words.length === 4) s += 5;
  if (words.length > 5) s -= (words.length - 5) * 5;
  if (name.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}$/)) s += 20;
  return s;
}

function tokenize(text) {
  return text.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Strip trailing punctuation, trademark symbols, and repeated name patterns.
 * "LAMI Architects LAMI Architects" → "LAMI Architects"
 */
function cleanCandidate(raw) {
  let cleaned = raw.replace(/™|®|©/g, '').replace(/[,.\s]+$/, '').trim();
  const words = cleaned.split(/\s+/);
  const mid = Math.floor(words.length / 2);
  const firstHalf = words.slice(0, mid).join(' ');
  const secondHalf = words.slice(mid).join(' ');
  if (mid >= 1 && secondHalf.toLowerCase() === firstHalf.toLowerCase()) {
    return firstHalf;
  }
  if (words.length >= 4) {
    const chunkSize = Math.floor(words.length / 2);
    const a = words.slice(0, chunkSize).join(' ');
    const b = words.slice(chunkSize).join(' ');
    if (a.toLowerCase() === b.toLowerCase()) return a;
  }
  return cleaned;
}

// ── Token collectors ────────────────────────────────────────────────────────────

/**
 * Collect words starting at `start`, stopping on stopwords or non-alpha.
 * Returns array of cleaned word tokens.
 */
function collectUntilStop(tokens, start, maxWords) {
  const STOPLIST = new Set([
    'looking','seeking','hiring','someone','anyone','developer','engineer',
    'designer','help','need','required','wanted','create','build','develop',
    'make','for','the','and','with','from','have','has','are','was','were',
    'that','it','not','you','your','we','our','its','this','these','those',
    'what','which','but','not','be','been','being','job','role','position',
    'project','task','experience','requirements','skills','based',
    'to','in','on','at','by','an','or','as','is','was','if','so',
    'our','my','his','her','their','its','a','an','the',
    'from','about','for','with','without','within',
    'app','built','java','built','this','the','and',
  ]);
  const words = [];
  for (let j = start; j < tokens.length && words.length < maxWords; j++) {
    const t = tokens[j];
    if (/^\n+$/.test(t)) break;
    if (!/[a-zA-Z]/.test(t)) break;
    const lower = t.toLowerCase();
    if (STOPLIST.has(lower) && words.length >= 1) break;
    words.push(t);
  }
  return words;
}

// ── Pattern extractors ─────────────────────────────────────────────────────────

/**
 * "Company: [Name]" — explicit label found in many Upwork job templates.
 * e.g. "Company:\nTicket Trust" or "Company: Acme Software"
 */
function findCompanyLabel(text) {
  const candidates = [];
  const re = /Company:\s*\n?\s*([A-Z][A-Za-z0-9 &.,'-]{2,50}?)(?:\s*[\n(]|$)/gm;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "We at [Company] are/is" — client names company in intro sentence.
 * e.g. "We at Revelio Labs are seeking a Web Scraping Expert."
 */
function findWeAt(text) {
  const candidates = [];
  const re = /\bWe at ([A-Z][A-Za-z0-9 &.,'-]{2,50}?) (?:are|is)\b/g;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "for [Company] to [action]" — typical task-scoping phrasing on Upwork.
 * e.g. "building an internal operating system for Burnsed Trucking to manage driver tours"
 */
function findForCompanyTo(text) {
  const candidates = [];
  const re = /\bfor ([A-Z][A-Za-z0-9 &.,'-]{2,50}?) to (?:manage|build|help|support|create|develop|run|automate|track|handle|process|deliver|launch|scale)\b/g;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "We are [Company]" / "We're a [Company]" / "I am [Company]"
 * Self-introduction: client names their own company.
 */
function findWeAreCompany(tokens) {
  const candidates = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toLowerCase();
    if (!['we', 'our', "i'm", "im", "i"].includes(tok)) continue;
    if (i + 2 >= tokens.length) continue;

    const next = tokens[i + 1]?.toLowerCase();
    const third = tokens[i + 2]?.toLowerCase();

    if ((next === 'are' || next === "'re" || next === 'have')) {
      if (third === 'looking' || third === 'seeking' || third === 'hiring') continue;
      const start = (third === 'a' || third === 'an' || third === 'the') ? i + 3 : i + 2;
      const words = collectUntilStop(tokens, start, 5);
      const name = cleanCandidate(words.join(' '));
      if (name.length >= 3) candidates.push(name);
    }

    if (next === 'brand' && tokens[i + 2]?.toLowerCase() === 'is' && i + 3 < tokens.length) {
      const words = collectUntilStop(tokens, i + 3, 5);
      const name = cleanCandidate(words.join(' '));
      if (name.length >= 3) candidates.push(name);
    }
  }
  return candidates;
}

/**
 * "We own [domain]" / "we own the [Company]"
 */
function findWeOwn(tokens) {
  const candidates = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toLowerCase();
    if (!['we', 'our'].includes(tok)) continue;

    const next = tokens[i + 1]?.toLowerCase();
    if (next === 'own' && i + 2 < tokens.length) {
      const start = tokens[i + 2]?.toLowerCase() === 'the' ? i + 3 : i + 2;
      const words = collectUntilStop(tokens, start, 4);
      const name = cleanCandidate(words.join(' '));
      if (name.length >= 3) candidates.push(name);
    }
    if (next === 'brand' && i + 2 < tokens.length && /^[A-Z]/.test(tokens[i + 2])) {
      const words = collectUntilStop(tokens, i + 2, 4);
      const name = cleanCandidate(words.join(' '));
      if (name.length >= 3) candidates.push(name);
    }
  }
  return candidates;
}

/**
 * "[Company] is a(n) [description]" — e.g. "Acme Corp is a B2B SaaS company"
 * Also catches marketplace/brand/community/network/team descriptions.
 */
function findCompanyIsA(text) {
  const candidates = [];
  // Broad match: anything after "is a/an"
  const broad = /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,4})\s+is\s+(?:a|an|our)\s+[^,.]{5,80}(?:,|$)/gi;
  for (const m of text.matchAll(broad)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  // Keyword-anchored match: "is a ... [keyword]" — catches descriptions at start of sentence
  const keywords = 'company|platform|tool|startup|agency|service|system|solution|app|SaaS|software|technology|firm|studio|team|group|leader|pioneer|provider|creator|maker|developer|marketplace|network|community|brand|product|suite';
  const anchored = new RegExp(`(?:^|\\n)([A-Z][A-Za-z0-9 &.,'-]{2,50}?) is (?:a |an )(?:[a-z]+ ){0,5}(?:${keywords})`, 'gm');
  for (const m of text.matchAll(anchored)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "[Company] — [Description]" or "[Company] : [Description]" as a standalone line.
 */
function findTitleLine(text) {
  const candidates = [];
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.length < 4) continue;
    // Skip lines that contain hyphenated noise patterns (e.g. "mobile-responsive", "end-to-end")
    if (/^(?=.*?(?:mobile-responsive|cross-platform|end-to-end|full-stack|ai-powered|real-time|self-starter|game-changing|open-source|front-end|back-end|world-class))/.test(line.toLowerCase())) continue;
    const m = line.match(/^([A-Z][a-zA-Z0-9]+(?:\s+[A-Za-z0-9&.,'\-]+){0,5})\s*[-–:]\s+.+/);
    if (m) {
      const name = cleanCandidate(m[1].trim());
      if (isGoodCompanyName(name)) candidates.push(name);
    }
  }
  return candidates;
}

/**
 * "at [domain].com" / "([domain].com)" / "www.[domain].com"
 */
function findDomain(text) {
  const candidates = [];
  const patterns = [
    /\bat\s+([a-z][a-z0-9\-]+)\.(?:co\.uk|com|org|io|ai|app|net)\b/gi,
    /\(([a-z][a-z0-9\-]+)\.(?:co\.uk|com|org|io|ai|app|net)\)/gi,
    /www\.([a-z][a-z0-9\-]+)\.(?:co\.uk|com|org|io|ai|app|net)/gi,
    /https?:\/\/([a-z][a-z0-9\-]+)\.(?:co\.uk|com|org|io|ai|app|net)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const raw = m[1].replace(/[-_]/g, ' ');
      const name = raw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (isGoodCompanyName(name)) candidates.push(name);
    }
  }
  return candidates;
}

/**
 * "[Company] LLC" / "[Company] Inc" / "[Company] Corp" etc.
 */
function findWithSuffix(text) {
  const candidates = [];
  const re = /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,4})\s+(?:LLC|Inc|Corp|Ltd|Co\.|Group|Partners|Holdings)\b/gi;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[0].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "called [Name]" / "named [Name]" — product/brand names
 */
function findCalled(text) {
  const candidates = [];
  const re = /(?:called|named)\s+(?:the\s+)?([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,4})\b/gi;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "About [Company]" — standalone section header on its own line (very common on Upwork).
 * e.g.  "About Nesavelle\nNesavelle is a rapidly growing..."
 * Also catches "About [Company] [Company] is a..." repeated-name pattern.
 */
function findAboutIntro(text) {
  const candidates = [];

  // Pattern 1 — standalone "About CompanyName" line
  const lineRe = /(?:^|\n)About\s+([A-Z][A-Za-z0-9 &.,'-]{2,50}?)\s*(?:\n|$)/gm;
  for (const m of text.matchAll(lineRe)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }

  // Pattern 2 — "about CompanyName is a/an/our/the"
  const introRe = /\babout\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\s+is\s+(?:a|an|our|the)/gi;
  for (const m of text.matchAll(introRe)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }

  return candidates;
}

/**
 * "[Company] is looking for / is hiring / is seeking …"
 * Extremely common Upwork opener — client names company then says what they need.
 * e.g. "Grupo Noa International is looking for English-Marshallese Interpreters."
 */
function findCompanyIsLooking(text) {
  const candidates = [];
  const re = /(?:^|\n)([A-Z][A-Za-z0-9 &.,'-]{2,50}?) is (?:currently )?(?:looking|hiring|seeking|searching|recruiting)\b/gm;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "[Company] is building / developing / creating / launching …"
 * Startups announcing what they are working on.
 * e.g. "Expensify is developing today's leading expense management tool."
 */
function findCompanyIsBuilding(text) {
  const candidates = [];
  const re = /(?:^|\n)([A-Z][A-Za-z0-9 &.,'-]{2,50}?) is (?:developing|building|creating|launching|powering|enabling|transforming|reimagining|revolutionizing)\b/gm;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "[role] at [Company]" — job posting where role + company appear together.
 * e.g. "As a Software Engineer at Imajine, you will be a key part of our team."
 * e.g. "Director of Marketing at Nesavelle reports to the CEO."
 */
function findRoleAtCompany(text) {
  const candidates = [];
  const re = /\b(?:role|position|job|engineer|developer|manager|director|specialist|analyst|designer|consultant|officer|head|lead)\s+at\s+([A-Z][A-Za-z0-9 &.,'-]{2,50}?)[,.\s]/gi;
  for (const m of text.matchAll(re)) {
    const name = cleanCandidate(m[1].trim());
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "github.com/CompanyName/" — GitHub org slug is often the company name.
 * e.g. "github.com/Expensify/App/issues/93067"
 */
function findGithubOrg(text) {
  const candidates = [];
  const re = /github\.com\/([A-Z][A-Za-z0-9-]{2,40})\//g;
  for (const m of text.matchAll(re)) {
    // Convert kebab-case to title case: "my-company" → "My Company"
    const raw = m[1].replace(/-/g, ' ').split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const name = cleanCandidate(raw);
    if (isGoodCompanyName(name)) candidates.push(name);
  }
  return candidates;
}

/**
 * "for [ProductName]" when [ProductName] is a CamelCase brand/app name.
 * Only matches when prev token is CamelCase 3+ chars (already named product/brand).
 */
function findBrandProduct(text, tokens) {
  const candidates = [];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].toLowerCase() !== 'for') continue;
    const prev = tokens[i - 1];
    if (/^[A-Z]/.test(prev) && prev.length >= 3 && isGoodCompanyName(prev)) {
      candidates.push(prev);
    }
  }
  return candidates;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function extractAll(text) {
  if (!text) return { company: null, linkedinUrls: [] };

  const linkedinUrls = new Set();
  for (const m of text.matchAll(LINKEDIN_URL_REGEX)) {
    linkedinUrls.add(m[0].replace(/\/$/, '').toLowerCase());
  }

  const tokens = tokenize(text);
  const allCandidates = [];

  for (const name of findCompanyLabel(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.6 });
  }
  for (const name of findWithSuffix(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.4 });
  }
  for (const name of findAboutIntro(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.4 });
  }
  for (const name of findWeAt(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.4 });
  }
  for (const name of findCompanyIsLooking(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.4 });
  }
  for (const name of findForCompanyTo(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.3 });
  }
  for (const name of findCompanyIsBuilding(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.3 });
  }
  for (const name of findWeAreCompany(tokens)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.3 });
  }
  for (const name of findWeOwn(tokens)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.2 });
  }
  for (const name of findCompanyIsA(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.1 });
  }
  for (const name of findRoleAtCompany(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.1 });
  }
  for (const name of findCalled(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.0 });
  }
  for (const name of findGithubOrg(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.0 });
  }
  for (const name of findBrandProduct(text, tokens)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.1 });
  }
  for (const name of findDomain(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 1.0 });
  }
  for (const name of findTitleLine(text)) {
    if (isGoodCompanyName(name)) allCandidates.push({ name, score: score(name) * 0.8 });
  }

  // Deduplicate
  const seen = new Map();
  for (const c of allCandidates) {
    const key = c.name.toLowerCase();
    if (!seen.has(key) || seen.get(key) < c.score) {
      seen.set(key, c.score);
    }
  }

  const sorted = [...seen.entries()]
    .map(([name, s]) => ({ name, score: s }))
    .sort((a, b) => b.score - a.score);

  return {
    company: sorted.length > 0 ? sorted[0].name : null,
    linkedinUrls: [...linkedinUrls]
  };
}

function extractCompany(text) {
  return extractAll(text).company;
}

module.exports = { extractCompany, extractAll, isGoodCompanyName };