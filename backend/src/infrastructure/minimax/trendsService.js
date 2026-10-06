const fs = require('fs');
const path = require('path');
const { callWebSearch } = require('./minimaxClient');

const RUNS_DIR = path.join(process.cwd(), 'data', 'runs');

/**
 * Score how recent a result is based on its date string.
 * Returns 0-30: 30 = very recent (this week / 2026), 0 = old / unknown.
 * Used to boost signal_value of recently-published content (proxy for "trending").
 */
function getRecencyScore(dateStr) {
  if (!dateStr) return 0;
  const s = String(dateStr).toLowerCase();
  if (/hours? ago|just now|yesterday|this week|today/i.test(s)) return 30;
  if (/2026|may 2026|jun 2026|may |jun /i.test(s)) return 30;
  if (/apr 2026|mar 2026|feb 2026|jan 2026/i.test(s)) return 25;
  if (/2025/i.test(s)) return 10;
  if (/2024|2023|2022|2021|2020/i.test(s)) return 0;
  return 5;
}

/**
 * Map of country input (ISO code or full name) → natural-language phrase
 * baked into the search query. MiniMax web_search has no built-in country
 * filter, so we append "in the US" / "in India" / etc. to nudge results
 * toward that region. Keys are normalized to lowercase for lookup.
 */
const COUNTRY_PHRASE_MAP = {
  // ISO 2-letter codes
  us: 'in the US',
  in: 'in India',
  gb: 'in the UK',
  uk: 'in the UK',
  ca: 'in Canada',
  au: 'in Australia',
  de: 'in Germany',
  fr: 'in France',
  es: 'in Spain',
  it: 'in Italy',
  jp: 'in Japan',
  cn: 'in China',
  br: 'in Brazil',
  mx: 'in Mexico',
  nl: 'in the Netherlands',
  sg: 'in Singapore',
  ae: 'in the UAE',
  sa: 'in Saudi Arabia',
  nz: 'in New Zealand',
  kr: 'in South Korea',
  ru: 'in Russia',
  za: 'in South Africa',
  ng: 'in Nigeria',
  eg: 'in Egypt',
  pk: 'in Pakistan',
  bd: 'in Bangladesh',
  ph: 'in the Philippines',
  id: 'in Indonesia',
  th: 'in Thailand',
  vn: 'in Vietnam',
  my: 'in Malaysia',
  ch: 'in Switzerland',
  se: 'in Sweden',
  no: 'in Norway',
  dk: 'in Denmark',
  fi: 'in Finland',
  pl: 'in Poland',
  tr: 'in Turkey',
  il: 'in Israel',
  ar: 'in Argentina',
  cl: 'in Chile',
  co: 'in Colombia',
  pe: 'in Peru',
  // Full country names
  'united states': 'in the US',
  'united states of america': 'in the US',
  'usa': 'in the US',
  'america': 'in the US',
  'india': 'in India',
  'united kingdom': 'in the UK',
  'great britain': 'in the UK',
  'britain': 'in the UK',
  'england': 'in the UK',
  'canada': 'in Canada',
  'australia': 'in Australia',
  'germany': 'in Germany',
  'france': 'in France',
  'spain': 'in Spain',
  'italy': 'in Italy',
  'japan': 'in Japan',
  'china': 'in China',
  'brazil': 'in Brazil',
  'mexico': 'in Mexico',
  'netherlands': 'in the Netherlands',
  'holland': 'in the Netherlands',
  'singapore': 'in Singapore',
  'uae': 'in the UAE',
  'united arab emirates': 'in the UAE',
  'saudi arabia': 'in Saudi Arabia',
  'new zealand': 'in New Zealand',
  'south korea': 'in South Korea',
  'korea': 'in South Korea',
  'russia': 'in Russia',
  'russian federation': 'in Russia',
  'south africa': 'in South Africa',
  'nigeria': 'in Nigeria',
  'egypt': 'in Egypt',
  'pakistan': 'in Pakistan',
  'bangladesh': 'in Bangladesh',
  'philippines': 'in the Philippines',
  'indonesia': 'in Indonesia',
  'thailand': 'in Thailand',
  'vietnam': 'in Vietnam',
  'malaysia': 'in Malaysia',
  'switzerland': 'in Switzerland',
  'sweden': 'in Sweden',
  'norway': 'in Norway',
  'denmark': 'in Denmark',
  'finland': 'in Finland',
  'poland': 'in Poland',
  'turkey': 'in Turkey',
  'türkiye': 'in Turkey',
  'israel': 'in Israel',
  'argentina': 'in Argentina',
  'chile': 'in Chile',
  'colombia': 'in Colombia',
  'peru': 'in Peru',
  // Special
  global: '',
  world: '',
  '': ''
};

function countryPhrase(countryCode) {
  if (!countryCode) return '';
  const key = String(countryCode).trim().toLowerCase();
  if (COUNTRY_PHRASE_MAP[key] !== undefined) return COUNTRY_PHRASE_MAP[key];
  // Unknown value — use as-is with "in" prefix
  return `in ${countryCode.trim()}`;
}

/**
 * Fetch trending topic candidates from MiniMax web_search.
 *
 * For each search term in searchTerms we fire a mix of time-qualified + topical
 * queries, all biased toward technology content (tutorials, guides, framework
 * comparisons, library releases, AI model announcements):
 *   1. "<term> <countryPhrase> <timeRange>"           — primary time-qualified
 *   2. "<term> <countryPhrase> <timeRange> news"      — broader recent coverage
 *   3. "trending <term> <countryPhrase>"              — general trending signal
 *   4. "<term> <countryPhrase> 2026"                  — current-year recency
 *   5. "<term> tutorial guide"                        — bias toward how-to content
 *   6. "<term> vs comparison"                         — bias toward X-vs-Y articles
 *   7. "<term> framework library release"             — bias toward tech releases
 *
 * Each phrase is scored by: base value (50 organic / 45 related) + recency bonus
 * from the result's date field. Phrases that appear in multiple queries get a
 * frequency boost (proxy for "popularity"). This approximates "trending" detection
 * since MiniMax web_search doesn't expose rising-query data.
 *
 * timeRange is controlled via TRENDS_TIME_RANGE env var (default: "this week").
 * Options: "today" (hottest), "this week" (recommended), "this month"
 *
 * Organic result titles become topic candidate phrases.
 * related_searches become secondary keywords.
 *
 * @param {object} deps
 * @param {string[]} deps.searchTerms — seed terms from config
 * @param {string} deps.geo — geographic filter (currently unused)
 * @param {string} deps.timeRange — natural-language time qualifier e.g. "this week" (from .env)
 * @param {string} deps.countryCode — ISO country code e.g. "US", "IN" (baked into query)
 * @returns {Promise<{input: object, items: Array}>}
 */
async function fetchTrendingTopicsFromMinimax(deps) {
  const { searchTerms, geo, timeRange = 'this week', countryCode } = deps;
  const cPhrase = countryPhrase(countryCode);

  // Normalize to array — split comma-separated string or use as-is if already array
  const terms = (typeof searchTerms === 'string')
    ? searchTerms.split(',').map(s => s.trim()).filter(Boolean)
    : Array.isArray(searchTerms) ? searchTerms : [];

  // Escape special regex characters in a string so it can be safely inserted
  // into a larger RegExp pattern. Used by SEED_CATEGORY_REGEX below.
  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Aggregate by normalized phrase so we can compute frequency and best raw
  const byPhrase = new Map();
  const PHRASE_RE = /[^a-zA-Z0-9\s&:]+/g;
  // Platform names that often appear as trailing author/source suffixes
  // (e.g. "...   Dailymotion", "... YouTube", "... LinkedIn"). Strips them
  // before the candidate is added to the pool.
  const PLATFORM_NAMES_STRIP = [
    'YouTube', 'Dailymotion', 'Vimeo', 'Twitch', 'Rumble', 'Bilibili',
    'LinkedIn', 'TFiR', 'Medium', 'Dev.to', 'Reddit', 'Substack',
    'GitHub', 'Stack Overflow', 'Hacker News', 'Twitter', 'X.com',
    'Facebook', 'Instagram', 'TikTok', 'Discord', 'Slack', 'Wikipedia',
    'Quora', 'Blog', 'Newsletter', 'Podcast', 'Patreon', 'Tumblr',
    'Pinterest', 'Snapchat', 'WhatsApp', 'Telegram',
    'Google News', 'Yahoo News', 'Flipboard',
    // Tech publications / vendor blogs that often appear as trailing source
    // (e.g. "X topic in 2026   Ksolves", "Y tutorial   Boot dev")
    'Ksolves', 'Ksolves Official', 'Boot dev', 'Boot.dev', 'Telerik',
    'Pluralsight', 'Educative', 'FreeCodeCamp', 'freeCodeCamp',
    'GeeksforGeeks', 'W3Schools', 'W3 Docs', 'Tutorialspoint',
    'JavaTpoint', 'Javatpoint', 'Tutorial Republic',
    'Robin Wieruch', 'Smashing Magazine', 'CSS-Tricks', 'A List Apart',
    'Video', 'Channel', 'Page', 'Site', 'Website'
  ];
  const stripPlatform = (p) => {
    let cleaned = p;
    for (const name of PLATFORM_NAMES_STRIP) {
      const esc = name.replace(/\./g, '\\.');
      cleaned = cleaned.replace(new RegExp('\\s+' + esc + '([^a-zA-Z].*)?$', 'i'), '');
      cleaned = cleaned.replace(new RegExp('\\s+' + esc + '\\s*$', 'i'), '');
    }
    return cleaned;
  };
  const stripSuffixes = (p) => p
    .replace(/\s*[|^—–-]\s*[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)*\s*$/g, '')
    .replace(/\s*by\s+[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)*\s*$/gi, '')
    .replace(/\s*at\s+[A-Z][a-zA-Z]+\s*$/gi, '')
    .trim();

  /**
   * Seeds that are ambiguous — they have a strong non-tech meaning that's
   * likely to dominate web_search results if used bare. Examples:
   *   "react" → verb (react to news)
   *   "java"  → island, coffee
   *   "spring"→ season, water spring
   *   "go"    → verb, board game
   *   "vue"   → French "view"
   *   "node"  → lymph node, graph node
   * For these, we prepend a tech qualifier to bare time/news queries so the
   * search engine returns framework/language results, not common-word uses.
   */
  const AMBIGUOUS_SEEDS = new Set([
    'react', 'java', 'spring', 'rust', 'go', 'swift', 'ruby', 'c', 'r',
    'angular', 'vue', 'ember', 'express', 'flask', 'django', 'lambda',
    'node', 'bun', 'haskell', 'scala', 'lua', 'dart', 'perl', 'julia',
    'matlab', 'octave', 'erlang', 'elixir', 'crystal', 'nim', 'zig'
  ]);

  /**
   * Seeds that LOOK like they could be ambiguous (1 short word) but are
   * actually unambiguous tech terms. These opt out of the auto-detect rule.
   */
  const UNAMBIGUOUS_TECH_TERMS = new Set([
    'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'graphql',
    'prometheus', 'postgresql', 'mongodb', 'elasticsearch', 'cypress',
    'playwright', 'typescript', 'python', 'golang', 'kotlin', 'rust', 'swift',
    'rustlang', 'tailwind', 'astro', 'svelte', 'nuxt', 'vercel', 'webpack',
    'vite', 'rollup', 'eslint', 'prettier', 'storybook', 'prisma', 'drizzle',
    'kafka', 'rabbitmq', 'redis', 'postgres', 'mysql', 'sqlite', 'mariadb',
    'supabase', 'firebase', 'dynamo', 'lambda', 'cloudfront', 'fastify'
  ]);

  /**
   * Returns true if the seed is likely to surface non-tech results when used
   * bare in a search query.
   */
  function isAmbiguousSeed(seed) {
    const t = String(seed || '').trim().toLowerCase();
    if (!t) return false;
    if (AMBIGUOUS_SEEDS.has(t)) return true;
    if (UNAMBIGUOUS_TECH_TERMS.has(t)) return false;
    return /^[a-z]{1,6}$/.test(t);
  }

  /**
   * Seed categories — used to fire category-appropriate qualifier queries.
   * Before this, the 4 "agentic" qualifier queries fired for EVERY seed, which
   * meant a frontend seed like "Frontend development" returned multi-agent
   * articles because the system asked for "frontend development multi-agent
   * architecture". Now each seed gets the qualifiers that match its domain.
   *
   * Priority order matters: first match wins.
   *   ai-agent > frontend > backend > devops > security > data > generic
   */
  const SEED_CATEGORY_KEYWORDS = {
    'ai-agent': [
      'ai', 'agent', 'llm', 'gpt', 'claude', 'gemini', 'ml',
      'machine learning', 'rag', 'embedding', 'langchain', 'mcp', 'copilot'
    ],
    'frontend': [
      'frontend', 'front-end', 'react', 'vue', 'angular', 'svelte', 'next', 'nuxt',
      'css', 'html', 'web', 'browser', 'dom', 'javascript', 'typescript',
      'tailwind', 'webpack', 'vite', 'ui', 'ux'
    ],
    'backend': [
      'backend', 'back-end', 'api', 'rest', 'graphql', 'grpc', 'server',
      'database', 'sql', 'nosql', 'postgres', 'mysql', 'mongo', 'redis',
      'auth', 'microservice', 'monolith', 'node', 'express', 'fastify',
      'django', 'flask', 'spring', 'lambda',
      // Programming languages commonly used for backend services
      'go', 'golang', 'rust', 'java', 'kotlin', 'ruby', 'php', 'scala', 'elixir', 'erlang'
    ],
    'devops': [
      'devops', 'kubernetes', 'k8s', 'docker', 'terraform', 'ansible',
      'jenkins', 'ci/cd', 'cicd', 'cloud', 'aws', 'gcp', 'azure',
      'monitoring', 'observability', 'prometheus', 'grafana', 'helm',
      'argocd', 'gitops'
    ],
    'security': [
      'security', 'oauth', 'jwt', 'vulnerability', 'cve', 'penetration',
      'exploit', 'encrypt', 'cryptography', 'zero trust', 'rbac', 'sso'
    ],
    'data': [
      'data', 'deep learning', 'neural', 'tensorflow', 'pytorch', 'sklearn',
      'pandas', 'spark', 'kafka', 'etl', 'elt', 'warehouse', 'lakehouse', 'dbt'
    ],
  };

  const SEED_CATEGORY_REGEX = Object.fromEntries(
    Object.entries(SEED_CATEGORY_KEYWORDS).map(([cat, kws]) => [
      cat,
      new RegExp('\\b(?:' + kws.map(escapeRegex).join('|') + ')\\b', 'i')
    ])
  );

  /**
   * Detects the seed's tech category so the right qualifier queries fire.
   */
  function getSeedCategory(seed) {
    const t = String(seed || '').trim();
    if (!t) return 'generic';
    for (const cat of ['ai-agent', 'frontend', 'backend', 'devops', 'security', 'data']) {
      if (SEED_CATEGORY_REGEX[cat].test(t)) return cat;
    }
    return 'generic';
  }

  /**
   * Returns 4 category-specific qualifier strings with the seed interpolated.
   * Replaces the old hardcoded multi-agent/agentic queries that fired for every
   * seed. Now: frontend seeds get frontend qualifiers, devops seeds get devops
   * qualifiers, etc.
   */
  function getCategoryQualifiers(category, seed) {
    const s = String(seed || '').trim();
    const templates = {
      'ai-agent': [
        'multi-agent architecture',
        'agentic workflow implementation',
        'production deployment scaling',
        'challenges pitfalls how to fix'
      ],
      'frontend': [
        'performance optimization',
        'state management patterns',
        'server components rendering',
        'build tooling 2026'
      ],
      'backend': [
        'api design patterns',
        'database performance scaling',
        'authentication security',
        'microservices vs monolith'
      ],
      'devops': [
        'kubernetes deployment patterns',
        'observability monitoring',
        'ci cd pipeline best practices',
        'infrastructure as code'
      ],
      'security': [
        'zero trust architecture',
        'supply chain security',
        'threat modeling',
        'vulnerability management'
      ],
      'data': [
        'data pipeline architecture',
        'feature store design',
        'mlops model deployment',
        'data warehouse vs lake'
      ],
      'generic': [
        'best practices 2026',
        'performance optimization',
        'production case study',
        'common pitfalls'
      ],
    };
    return (templates[category] || templates.generic)
      .map(q => `${s} ${q}`.replace(/\s+/g, ' ').trim());
  }

  /**
   * Junk patterns — phrases that match are rejected before being added as candidates.
   * Tuned for IT/tech audience: rejects listicles, vague questions, Reddit suffixes,
   * generic news, and non-technical commercial content.
   */
  const JUNK_TITLE_PATTERNS = [
    // Listicles: "Top 9 X", "10 best X", "16 best X", "5 tools to..." etc.
    // Matches: leading number + best/top, OR leading top/best + number, OR bare "best/top + plural-noun"
    /\b\d+\s+(best|top|essential|must.?have|amazing|awesome|insane)\s+/i,
    /\b(top|best)\s+\d+\s+/i,
    /\b(best|top|essential|amazing)\s+(tools|software|apps|platforms|services|companies|agencies|libraries|frameworks|resources|extensions|plugins)\b/i,
    // "X tools" / "X software" standalone listicle (no specificity)
    /^\d+\s+\w+(\s+\w+){0,3}$/i,
    // "X explained" / "X a complete guide" with weak specificity
    /\b(benefits|challenges|advantages|disadvantages|pros and cons|everything you need to know)\b.*\b(explained|defined|overview|introduction)\b/i,
    /\bexplained\b.*\b(benefits|challenges|advantages)\b/i,
    // Reddit-style " : r/subreddit" or " : r Frontend"
    /\s*:\s*r\s*\/?\w*$/i,
    // Subreddit markers at end
    /\s*subreddit\s*$/i,
    // Vague question starters (low quality)
    /^(looking for|need help with|any recommendations?|can anyone|suggest me|what do you think about|is it worth|are .* the future)\b/i,
    // "I almost sort of like..." first-person blog posts
    /^(i (almost )?(sort of )?(like|love|hate|dislike)|my (honest )?(thoughts|review|experience))\b/i,
    // "X jobs / job market / hiring" (not technical content)
    /\b(job(s)?|hiring|career(s)?|salary|interview)\s+(market|in|for|at|2026|2025)?\b/i,
    /\b(job(s)?|hiring|career(s)?)\b/i,
    // "X courses / tutorial for beginners" (not advanced tech content)
    /\b(courses?|training|certification|bootcamp)\s+(for|to)\b/i,
    // "X near me" / "X for free" / "X download" / "X torrent" (consumer junk)
    /\bnear me\b/i,
    /\bfor free\b/i,
    /\bfree download\b/i,
    /\btorrent\b/i,
    /\bcrack\b/i,
    // Consumer products/services
    /\b(amazon|walmart|ebay|target|costco)\b/i,
    // Salary / compensation
    /\b(salary|compensation|pay scale)\b/i,
    // ─── Verb-usage of ambiguous seeds (hard-reject worst offenders) ───
    // "react to <news event>" with specific news subjects
    /\b(react|reacts|reacted|reacting)\s+to\s+(the\s+)?(news|strike|attack|death|verdict|ruling|announcement|statement|decision|crisis|outrage|controversy|backlash|shooting|explosion|earthquake|protests?|demonstrations?|allegations?|revelations?)\b/i,
    // "<nationality/group> react to ..." — viral reaction videos / news
    /\b(indians?|pakistanis?|americans?|british|europeans?|chinese|russians?|ukrainians?|israelis?|iranians?|netizens?|fans?|viewers?|leaders?|people|crowd|public|world|commenters?|users?|voters?|citizens?|customers?|shoppers?)\s+(react|reacts|reacted|reacting)\b/i,
    // Generic breaking-news / political shapes
    /\bhow\s+(world\s+)?leaders?\s+react\b/i,
    /\bbreaking:?\s/i,
  ];

  /**
   * Tech-bias patterns — phrases matching any of these get a signal boost because
   * they signal tutorials, framework comparisons, library releases, or AI models —
   * exactly the kind of "advanced IT/tech knowledge base" topics the audience wants.
   *
   * Tuned for the kinds of advanced topics senior engineers actually read:
   * multi-agent systems, agentic workflows, RAG/MCP, production deployment,
   * architecture patterns, framework comparisons, security depth.
   */
  const TECH_BIAS_PATTERNS = [
    // Tutorial / how-to / deep-dive framing
    /\b(tutorial|guide|how to|step by step|step-by-step|walkthrough|deep dive|deep-dive|practical guide|complete guide)\b/i,
    // Comparison / alternative
    /\b(vs\.?|versus|comparison|compare|alternative to|compared to)\b/i,
    // Release / migration / breaking change
    /\b(framework|library|package|module|sdk|api|tool)\s+(release|launch|update|version)\b/i,
    /\b(release notes|changelog|what.?s new|breaking changes|migration)\b/i,
    // Architecture / patterns
    /\b(architecture|design pattern|best practices|production|infra(structure)?|orchestrat|workflow)\b/i,
    // Programming languages
    /\b(rust|golang|typescript|python|java|kotlin|swift|react|vue|angular|next\.?js|nuxt|svelte|node|deno|bun)\b/i,
    // ─── AI / LLM / agent specific (the highest-signal patterns) ───
    // Multi-agent / agentic / autonomous
    /\b(multi[\s-]?agent|single[\s-]?agent|agentic|autonomous agent|ai agent|agent framework|agent architecture|agent orchestration|agent workflow|agent pattern)\b/i,
    // LLM models and providers
    /\b(llm|gpt[\s-]?[0-9]?|claude[\s-]?[0-9]?|gemini|llama|mistral|openai|anthropic|copilot|cursor)\b/i,
    // RAG / embeddings / vector
    /\b(embedding|vector (db|database|store)|rag|retrieval[\s-]?augmented|semantic search)\b/i,
    // MCP / LangChain / agent frameworks
    /\b(mcp|langchain|langgraph|llamaindex|haystack|autogen|crewai|semantic kernel|smolagents)\b/i,
    // Prompt engineering / fine-tuning
    /\b(prompt[\s-]?engineer|fine[\s-]?tun(e|ing)|rlhf|alignment|guardrails?|hallucination)\b/i,
    // ─── DevOps / infra ───
    /\b(kubernetes|docker|terraform|ansible|helm|argocd|prometheus|grafana|datadog|opentelemetry)\b/i,
    // ─── Testing / QA ───
    /\b(playwright|cypress|selenium|jest|vitest|puppeteer|end[\s-]?to[\s-]?end|e2e|integration test|unit test|test automation)\b/i,
    // ─── APIs / protocols ───
    /\b(graphql|grpc|websocket|rest api|openapi|event[\s-]?driven|message queue|kafka|rabbitmq)\b/i,
    // ─── Security ───
    /\b(security|vulnerability|cve|penetration|exploit|zero[\s-]?day|threat model|supply chain|sbom)\b/i,
    // ─── Performance / observability ───
    /\b(performance|optimi[sz]ation|profiling|latency|throughput|benchmark|cache invalidation)\b/i,
    /\b(observability|monitoring|tracing|logging|alerting|slo|sla)\b/i,
    // ─── CI/CD / DevOps ───
    /\b(ci[\s/-]?cd|pipeline|deployment|release|gitops|devops|infrastructure as code)\b/i,
    // ─── Databases ───
    /\b(database|sql|nosql|postgres|mysql|redis|mongo|kafka|rabbitmq|elasticsearch|timescale)\b/i,
    // ─── Cloud ───
    /\b(cloud|aws|azure|gcp|lambda|serverless|edge|kubernetes|knative)\b/i,
    // ─── Distributed systems ───
    /\b(microservice|monolith|event[\s-]?driven|distributed|consensus|scaling|sharding|replication|cqrs|event[\s-]?sourcing|saga)\b/i,
    // ─── Auth ───
    /\b(auth|oauth|jwt|saml|zero[\s-]?trust|encryption|tls|ssl|rbac)\b/i,
    // ─── Problem-solution framing (highly engaged senior-engineer content) ───
    /\bwhy (is|are|does|did|do) .* (fail|broken|slow|wrong|hard|bad)/i,
    /\bhow to (fix|solve|debug|optimi[sz]e|scale|secure|harden|migrate|modernize)/i,
    /\b(common (pitfalls?|mistakes|anti[\s-]?patterns|errors))/i,
    /\b(production[\s-]?ready|production[\s-]?grade|at scale|enterprise[\s-]?grade)\b/i,
    // Outcome / metric framing (case-study style)
    /\b(cuts?|reduces?|increases?|improves?|saves?)\s+.*(time|cost|by \d+|latency|throughput)/i,
    /\b(roi|case study|benchmark|results|metrics?)\b/i,
  ];

  const TECH_BIAS_BONUS = 12;

  /**
   * Per-seed regexes that match the seed in its NON-tech sense. If any
   * matches the candidate phrase, we strip the +12 TECH_BIAS_BONUS so the
   * phrase doesn't outrank genuine engineering content.
   *
   * Defense-in-depth layer that runs AFTER the junk filter has rejected
   * the worst verb-uses. Catches subtler cases like "How world leaders
   * react to the crisis" (no junk match, but clearly news).
   */
  const NON_TECH_NEIGHBORHOOD_PATTERNS = {
    react: [
      /\breact(ing|s|ed)?\s+to\b/i,
      /\bhow .*\breact\b/i,
      /\b(react(ed|ing|s)?\s+to\s+)(the\s+)?(news|strike|attack|death|verdict|statement|crisis|outrage|controversy|backlash|shooting|explosion|earthquake|protests?|decision|announcement|outcome|allegation|claim|revelation)\b/i,
      /\b(indians?|pakistanis?|americans?|british|europeans?|chinese|russians?|ukrainians?|israelis?|iranians?|netizens?|fans?|viewers?|leaders?|people|crowd|public|world|commenters?|users?|voters?|citizens?|customers?|shoppers?)\s+react/i,
    ],
    java: [
      /\bjava\s+(island|coffee|coffeehouse|street|state\s+of)\b/i,
    ],
    spring: [
      /\bspring\s+(season|weather|allergies|flowers|cleaning|mattress|water|is\s+here|arrived|comes)\b/i,
    ],
    rust: [
      /\b(rust\s+)?(corrosion|prevent|remover|paint|color|orange|brown|patina|stain)\b/i,
      /\biron\s+(will\s+)?rust\b/i,
    ],
    go: [
      /\blet'?s\s+go\b/i, /\bhave\s+a\s+go\b/i, /\bon\s+the\s+go\b/i,
      /\bgo\s+(team|match|game|fish|slow|fast|away|home)\b/i,
    ],
    swift: [
      /\b(songbird|bird)\s+swift\b/i, /\bas\s+swift\s+as\b/i, /\btaylor\s+swift\b/i,
    ],
    ruby: [/\bruby\s+(gemstone|color|red|crimson|gem)\b/i],
    angular: [
      /\bangular\s+(motion|velocity|displacement|momentum|shape|geometry)\b/i,
    ],
    vue: [
      /\b(point\s+de\s+)?vue\s+(de|par|sur|d.?ensemble)\b/i,
    ],
    node: [
      /\blymph\s+node/i, /\bnode\s+(point|graph|network)\b/i,
    ],
    bun: [/\bbun\s+(hairstyle|hair|rabbit|dog|tail)\b/i],
    flask: [/\b(hip\s+)?flask\b/i, /\bflask\s+(of|containing)\b/i],
    django: [/\bdjango\s+(unchained|film|movie)\b/i],
    express: [/\bexpress\s+(delivery|shipping|courier|bus|train|mail)\b/i],
    ember: [/\bember(s)?\s+(of|smoldering|glowing|dying|fading)\b/i],
    c: [
      /\bsee\s+(the|how|why|what|where|if|article|section)\b/i,
      /\bgrade\s+[a-f]\b/i,
    ],
    r: [],
  };

  /**
   * Generic news-headline shapes that pollute all seeds (politics, sports,
   * celebrity, breaking news). These are noise for a tech-blog audience.
   */
  const DEFAULT_NON_TECH_PATTERNS = [
    /\bbreaking:?\s/i,
    /\bhow\s+(world\s+)?leaders?\s+react\b/i,
    /\bindians?\s+react\s+to\b/i,
  ];

  /**
   * Returns true if the phrase is using the seed in a non-tech sense and
   * therefore should NOT receive the +12 tech-bias bonus.
   */
  function isNonTechContextForSeed(phrase, sourceSeed) {
    if (!phrase || !sourceSeed) return false;
    const seedKey = String(sourceSeed).trim().toLowerCase();
    const patterns = NON_TECH_NEIGHBORHOOD_PATTERNS[seedKey] || [];
    if (patterns.some(p => p.test(phrase))) return true;
    return DEFAULT_NON_TECH_PATTERNS.some(p => p.test(phrase));
  }

  const addCandidate = (phrase, sourceSeed, isRelated, raw) => {
    let clean = String(phrase || '').replace(PHRASE_RE, ' ').trim();
    if (!clean || clean.length < (isRelated ? 3 : 5)) return;
    clean = stripPlatform(clean);
    clean = stripSuffixes(clean);
    if (!clean || clean.length < (isRelated ? 3 : 5)) return;
    // Reject junk patterns
    if (JUNK_TITLE_PATTERNS.some((p) => p.test(clean))) return;
    const key = clean.toLowerCase();
    const existing = byPhrase.get(key);
    const baseValue = isRelated ? 45 : 50;
    const recencyBonus = getRecencyScore(raw && raw.date);
    // Strip the +12 tech-bonus when the seed is being used in a non-tech
    // sense (e.g. "react" the verb, "How leaders react to news"). This
    // prevents news/verb-uses from outranking genuine engineering content.
    const techMatched = TECH_BIAS_PATTERNS.some((p) => p.test(clean));
    const isNonTech = isNonTechContextForSeed(clean, sourceSeed);
    const techBonus = (techMatched && !isNonTech) ? TECH_BIAS_BONUS : 0;
    const value = baseValue + recencyBonus + techBonus;
    if (existing) {
      existing.frequency += 1;
      existing.maxSignal = Math.max(existing.maxSignal, value);
      existing.sumSignal += value;
      // Track the best-scored raw entry (most recent result wins)
      if (recencyBonus > (existing.bestRecency || 0)) {
        existing.bestRecency = recencyBonus;
        existing.raw = raw;
      }
      if (techBonus > 0) existing.hasTechBias = true;
    } else {
      byPhrase.set(key, {
        phrase: clean,
        source_seed: sourceSeed,
        is_related: isRelated,
        frequency: 1,
        maxSignal: value,
        sumSignal: value,
        bestRecency: recencyBonus,
        hasTechBias: techBonus > 0,
        raw
      });
    }
  };

  for (const seed of terms) {
    // Twelve query patterns per seed, layered to surface advanced engineering content:
    //   • 4 time/news queries (rewritten for ambiguous seeds — see below)
    //   • 3 tech-framing qualifiers (tutorial, vs, release)
    //   • 1 platform-biased query (engineering sources)
    //   • 4 agentic/AI-engineering specific qualifiers (the highest-signal layer)
    // Country is baked in (e.g. "AI agents in the US this week").
    //
    // For AMBIGUOUS seeds (e.g. "react" = verb, "java" = island, "go" = verb),
    // the 4 bare time/news queries get a tech qualifier prepended so the
    // search engine returns framework/language results, not common-word uses.
    // The 8 tech-framed queries are already specific and stay as-is.
    const isAmb = isAmbiguousSeed(seed);
    const techPre = isAmb ? 'programming language framework library' : '';
    // Fire category-appropriate qualifiers so "Frontend development" doesn't
    // get multi-agent queries, and "Kubernetes" doesn't get React queries.
    const category = getSeedCategory(seed);
    const qualifiers = getCategoryQualifiers(category, seed);
    const queries = [
      // Time / recency (broad) — prepended tech qualifier when ambiguous
      `${techPre} ${seed} ${cPhrase} ${timeRange}`.replace(/\s+/g, ' ').trim(),
      `${techPre} ${seed} ${cPhrase} ${timeRange} news`.replace(/\s+/g, ' ').trim(),
      `trending ${techPre} ${seed} ${cPhrase}`.replace(/\s+/g, ' ').trim(),
      `${techPre} ${seed} ${cPhrase} 2026`.replace(/\s+/g, ' ').trim(),
      // Tech framing (already specific — unchanged)
      `${seed} tutorial guide`.replace(/\s+/g, ' ').trim(),
      `${seed} vs comparison`.replace(/\s+/g, ' ').trim(),
      `${seed} framework library release`.replace(/\s+/g, ' ').trim(),
      // Engineering sources
      `${seed} engineering blog dev.to github stackoverflow`.replace(/\s+/g, ' ').trim(),
      // ─── Category-specific qualifiers (dynamic; matches the seed's domain) ───
      qualifiers[0],
      qualifiers[1],
      qualifiers[2],
      qualifiers[3]
    ];

    for (const query of queries) {
      let data;
      try {
        data = await callWebSearch(query);
      } catch (err) {
        console.warn(`  [Minimax Trends] web_search failed for "${query}": ${err.message}`);
        continue;
      }

      const organic = data && Array.isArray(data.organic) ? data.organic : [];
      const related = data && Array.isArray(data.related_searches) ? data.related_searches : [];

      for (const item of organic) addCandidate(item.title, seed, false, item);
      for (const r of related) addCandidate(r.query || r.title, seed, true, r);
    }
  }

  // Compute final signal_value: combine max signal with frequency boost
  // Frequency boost: each additional appearance adds up to 8 points (capped)
  const allCandidates = [];
  for (const entry of byPhrase.values()) {
    const frequencyBoost = Math.min((entry.frequency - 1) * 8, 24);
    const signalValue = entry.maxSignal + frequencyBoost;
    allCandidates.push({
      phrase: entry.phrase,
      source_seed: entry.source_seed,
      signal_value: signalValue,
      frequency: entry.frequency,
      bestRecency: entry.bestRecency,
      maxSignal: entry.maxSignal,
      frequencyBoost,
      hasTechBias: !!entry.hasTechBias,
      raw: entry.raw
    });
  }

  // Log scoring summary so trendsService visibility in run logs
  const sortedByScore = [...allCandidates].sort((a, b) => b.signal_value - a.signal_value);
  const freqDistribution = allCandidates.reduce((acc, c) => {
    acc[c.frequency] = (acc[c.frequency] || 0) + 1;
    return acc;
  }, {});
  const techBiasCount = allCandidates.filter((c) => c.hasTechBias).length;
  console.log(`[Trends] Aggregated ${allCandidates.length} unique phrases | tech-bias: ${techBiasCount}/${allCandidates.length} | freq distribution: ${JSON.stringify(freqDistribution)}`);
  console.log(`[Trends] Top 10 by signal_value (recency + base + tech bonus + freq boost):`);
  sortedByScore.slice(0, 10).forEach((c, i) => {
    const techTag = c.hasTechBias ? ' TECH' : '';
    console.log(`  ${i + 1}. "${c.phrase}" | seed="${c.source_seed}" | base+recency=${c.maxSignal} | freq=${c.frequency} (boost=+${c.frequencyBoost}) | FINAL=${c.signal_value}${techTag}`);
  });

  return {
    input: { searchTerms, geo, countryCode: countryCode || null, countryPhrase: cPhrase, fetchedAt: new Date().toISOString() },
    items: allCandidates
  };
}

/**
 * Flatten the items returned by fetchTrendingTopicsFromMinimax.
 * Items are already aggregated by phrase in fetchTrendingTopicsFromMinimax,
 * with signal_value reflecting base + recency bonus + frequency boost (range ~50-104).
 * This function normalizes the shape for downstream keyword filtering.
 *
 * @param {Array} items — items from fetchTrendingTopicsFromMinimax
 * @returns {{ phrase: string, source_seed: string, signal_value: number, frequency?: number, raw: object }[]}
 */
function flattenRisingRelatedQueries(items) {
  return items.map((row) => ({
    phrase: String(row.phrase || '').trim(),
    source_seed: String(row.source_seed || '').trim(),
    signal_value: Number(row.signal_value) || 50,
    frequency: row.frequency || 1,
    raw: row.raw || {}
  }));
}

function saveTrendsPayload(runsDir, runId, payload) {
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const filePath = path.join(runsDir, `${runId}-trends.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

module.exports = {
  fetchTrendingTopicsFromMinimax,
  flattenRisingRelatedQueries,
  saveTrendsPayload
};