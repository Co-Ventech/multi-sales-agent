const { normalizePhrase, matchesNiche, isJunk } = require('../domain/keywordPolicy');

/**
 * A) Flatten rising (caller passes flattened rows)
 * B) Niche filter C) Junk D) Dedupe published E) Rank F) top 5 + picked
 *
 * @param {Array<{ phrase: string, source_seed: string, signal_value: number }>} risingRows
 * @param {Set<string>} publishedNormalized
 * @returns {{ winners: object[], picked: object | null }}
 */
const PLATFORM_NAMES_STRIP = [
  // Video platforms
  'YouTube', 'Dailymotion', 'Vimeo', 'Twitch', 'Rumble', 'Bilibili',
  // Social / content
  'LinkedIn', 'TFiR', 'Medium', 'Dev.to', 'Reddit', 'Substack',
  'GitHub', 'Stack Overflow', 'Hacker News', 'Twitter', 'X.com',
  'Facebook', 'Instagram', 'TikTok', 'Discord', 'Slack', 'Wikipedia',
  'Quora', 'Blog', 'Newsletter', 'Podcast', 'Patreon', 'Tumblr',
  'Pinterest', 'Snapchat', 'WhatsApp', 'Telegram',
  // News aggregators
  'Google News', 'Yahoo News', 'Flipboard',
  // Tech publishers / analyst firms
  'Dataforest', 'Moveworks', 'Coveo', 'Crossmint', 'Virtuoso', 'Vellum',
  'Gartner', 'Forrester', 'IDC', 'McKinsey', 'Deloitte', 'Accenture',
  'BCG', 'PwC', 'Cloudflare', 'AlphaCorp', 'Forbes', 'TechCrunch',
  'ZDNet', 'Wired', 'VentureBeat', 'InfoQ', 'DZone', 'ThoughtWorks',
  'Atlassian', 'HashiCorp', 'Databricks', 'Snowflake', 'Confluent',
  'Elastic', 'Grafana', 'Datadog', 'Splunk',
  // Generic suffix
  'Video', 'Channel', 'Page', 'Site', 'Website'
];

function stripPlatformSuffix(phrase) {
  // Strip platform name if it appears at end: " ... YouTube" or "AuthorName LinkedIn"
  let cleaned = phrase;
  for (const p of PLATFORM_NAMES_STRIP) {
    cleaned = cleaned.replace(new RegExp('\\s+' + p.replace(/\./g, '\\.') + '([^a-zA-Z].*)?$', 'i'), '');
    cleaned = cleaned.replace(new RegExp('\\s+' + p.replace(/\./g, '\\.') + '\\s*$', 'i'), '');
  }
  return cleaned.trim();
}

/**
 * Junk topic patterns — defense-in-depth layer that runs after trendsService
 * has already filtered. Rejects low-quality / non-technical / commercial
 * listicles that slipped through (e.g. from search results returned via
 * related_searches or from queries that bypassed trendsService entirely).
 * Kept in sync with JUNK_TITLE_PATTERNS in trendsService.js.
 */
// Tech-context whitelist: if any of these appear, the phrase is considered
// an engineering deep-dive and the consumer-listicle rejections are relaxed.
const TECH_CONTEXT_TERMS = /\b(ai|agent|agentic|llm|gpt|claude|gemini|rag|embedding|vector|mcp|langchain|autogen|crewai|devops|kubernetes|docker|kafka|graphql|api|backend|frontend|microservice|serverless|cloud|aws|gcp|azure|distributed|concurren|async|rust|golang|typescript|python|node|react|vue|svelte|next|nuxt|astro|tailwind|postgres|mysql|redis|mongo|elastic|terraform|ansible|jenkins|github|gitlab|cicd|observab|monitor|securit|encrypt|oauth|jwt|sso|architect|scalab|perform|optimi|debug|profil|test|qa|ci|cd|wasm|webgpu|grpc|protobuf|docker|k8s|helm|istio|linkerd|prometheus|grafana|opentelemetry)\b/i;

const JUNK_TOPIC_PATTERNS = [
  // Listicles: "16 best X", "10 best X", "Top 9 X" (consumer listicles)
  // Reject only when NOT in a tech context
  {
    re: /\b\d+\s+(best|top|essential|must.?have|amazing|awesome|insane)\s+/i,
    skipIfTech: true,
  },
  {
    re: /\b(top|best)\s+\d+\s+/i,
    skipIfTech: true,
  },
  // "best tools" / "best software" / "best libraries" — pure listicle SEO
  /\b(best|top|essential|amazing)\s+(tools|software|apps|platforms|services|companies|agencies|libraries|frameworks|resources|extensions|plugins)\b/i,
  // "5 Critical Benefits" / "3 Hidden Challenges" — too short to be a real topic
  /^\d+\s+\w+(\s+\w+){0,3}$/i,
  // "X benefits explained" / "X challenges and best practices" weak-signal SEO titles
  /\b(benefits|challenges|advantages|disadvantages|pros and cons|everything you need to know)\b.*\b(explained|defined|overview|introduction)\b/i,
  /\bexplained\b.*\b(benefits|challenges|advantages)\b/i,
  // Reddit-style suffix: "UK Job Market : r Frontend"
  /\s*:\s*r\s*\/?\w*$/i,
  // Vague Q&A starters
  /^(looking for|need help with|any recommendations?|can anyone|suggest me|what do you think about|is it worth|are .* the future)\b/i,
  // First-person blog post starters
  /^(i (almost )?(sort of )?(like|love|hate|dislike)|my (honest )?(thoughts|review|experience))\b/i,
  // Job / career
  /\b(job(s)?|hiring|career(s)?|salary|interview)\b/i,
  // Consumer junk
  /\b(near me|for free|free download|torrent|crack)\b/i,
  /\b(amazon|walmart|ebay)\b/i,
  // Beginner / non-advanced audience
  /\bfor beginners\b/i,
  /\b(courses?|training|certification|bootcamp)\b/i,
];

function isJunkTopic(phrase) {
  if (!phrase) return true;
  if (phrase.length < 8) return true;  // too short to be a meaningful topic
  const isTechContext = TECH_CONTEXT_TERMS.test(phrase);
  for (const entry of JUNK_TOPIC_PATTERNS) {
    // Regex literals are typeof 'object' too — distinguish by whether
    // it's a plain config object (has .re field) or a regex itself.
    const isConfig = entry && typeof entry === 'object' && 're' in entry;
    if (isConfig) {
      if (entry.skipIfTech && isTechContext) continue;
      if (entry.re.test(phrase)) return true;
    } else {
      if (entry.test(phrase)) return true;
    }
  }
  return false;
}

function filterRankAndPick(risingRows, publishedNormalized) {
  const byPhrase = new Map();
  let junkSkipped = 0;

  for (const row of risingRows) {
    const phrase = stripPlatformSuffix(row.phrase.trim());
    if (!phrase || phrase.length < 3) continue;
    if (isJunkTopic(phrase)) { junkSkipped++; continue; }
    const normalized = normalizePhrase(phrase);
    if (!normalized || isJunk(normalized)) continue;
    if (!matchesNiche(normalized)) continue;
    if (publishedNormalized.has(normalized)) continue;

    const prev = byPhrase.get(normalized);
    const next = {
      phrase,
      phrase_normalized: normalized,
      signal_value: Number(row.signal_value) || 0,
      source_seed: row.source_seed || ''
    };
    if (!prev || next.signal_value > prev.signal_value) byPhrase.set(normalized, next);
  }

  const winners = [...byPhrase.values()].sort((a, b) => b.signal_value - a.signal_value);

  const top5 = winners.slice(0, 5);
  const picked = top5[0] || null;

  if (junkSkipped > 0) {
    console.log(`[Keywords] Skipped ${junkSkipped} junk topic(s) (listicles / Q&A / jobs / Reddit suffixes)`);
  }

  return { winners: top5, picked, allRanked: winners };
}

module.exports = { filterRankAndPick, isJunkTopic };
