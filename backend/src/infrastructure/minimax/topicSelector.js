/**
 * Deep topic research and scorer using MiniMax only.
 *
 * Step 3 of the pipeline — takes niche-filtered candidates and:
 * 1) Deep-researches each with 6 search angles per candidate
 * 2) Computes SEO + trend signals incl. intent, gap, semantic dedup
 * 3) Has MiniMax LLM pick the best topic with full context
 */
const { callWebSearch } = require('./minimaxClient');

/**
 * Call MiniMax chat completions HTTP API directly.
 * @param {string} prompt
 * @param {number} maxTokens
 * @param {number} timeoutMs - request timeout in milliseconds (default 60000)
 */
async function minimaxChat(prompt, maxTokens = 2000, timeoutMs = 60000) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const apiHost = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
  if (!apiKey) throw new Error('MINIMAX_API_KEY is required');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiHost}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: maxTokens,
        temperature: 0.3
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`MiniMax API timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// ─── Intent Classification ────────────────────────────────────────────────────

const INTENT_PATTERNS = {
  COMMERCIAL: [
    /\b(best|top|review|comparison|vs|versus|alternative|competitor|工具)\b/i,
    /\b(price|cost|pricing|cheap|free trial|license)\b/i,
    /\b(software|platform|service|tool)s?(2026|2025)?\b/i,
    /\b(pick|choose|compare)\b.*\b(best|top|tool|software)\b/i,
  ],
  NAVIGATIONAL: [
    /\b(official|website|login|homepage|download)\b/i,
    /\b(download|get|install)\s+(here|now|today)\b/i,
    /^((?!.*\bhow\b|\bwhat\b|\bwhy\b|\bguide\b).)*\.(com|org|io|net)\b/i,
  ]
};

const NEWS_HEADLINE_PATTERNS = [
  /\b(it\x27s|it is|it has|its) been a (?:big )?week\b/i,
  /\b(latest|recent) (?:news|today)(?:\s|$|:)/i,
  /\b(massive|big|huge) (?:week|year|day) for\b/i,
  /\b(get ready for|revolution|set to dominate)\b/i,
  /\bwhat happened\b/i,
  /\beverything you need to know\b/i,
  /\bupdates?\b/i,
  /\btrending\b/i,
  /\bhere is|here are \d+ (?:massive|big|important)\b/i,
  /\bnews:\b/i,
  /\b(?:is|are|was|will be) (?:set to |going to )?(?:dominate|explode|grow|take over|replace)\b/i,
  // Year in middle of phrase without guide/comparison/how-to keywords (e.g. "X in 2026: What to Expect")
  /\b(?:in|for|after) (?:20)?\d{4}(?::|\s)/i,
  // "X in Y" style without actionable keyword
  /^(?!.*\b(?:guide|tutorial|how to|vs|comparison|review|setup|implement|configure|getting started|best practices|intro)\b).*\b(?:in|for|after) (?:20)?\d{4}\b/i,
  // Year-at-start pattern (e.g. "2026: The Year of AI")
  /^(?:20)?\d{4}:?\s/i,
  // Generic year-only title without actionable words
  /^(?!.*\b(?:guide|tutorial|how to|vs|comparison|review|setup|implement|configure|getting started|best practices|intro)\b).*\b\d{4}\b$/i,
  // News at start of title
  /\bnews\b/i,
  // "breaking" news style
  /\bbreaking\b/i,
  // Listicle-style with digits before key topic words
  /\b\d+ (?:massive|big|important|awesome|insane) /i,
];

/**
 * Returns true if the phrase looks like a news headline rather than a search-friendly guide.
 */
function isNewsHeadline(phrase) {
  const lower = phrase.toLowerCase();
  return NEWS_HEADLINE_PATTERNS.some((p) => p.test(lower));
}

// Common English words that appear title-cased in headlines but are NOT author/publisher names.
// Prevents false positives like "Are Taking America" or "Two Different Futures".
const AUTHOR_CHECK_EXCLUSIONS = new Set([
  'are', 'is', 'was', 'were', 'the', 'and', 'for', 'not', 'but', 'yet', 'nor', 'so',
  'than', 'that', 'this', 'with', 'from', 'into', 'how', 'why', 'what', 'when', 'where',
  'will', 'can', 'may', 'should', 'could', 'would', 'have', 'has', 'had',
  'taking', 'making', 'doing', 'going', 'coming', 'having', 'being', 'using', 'building',
  'future', 'futures', 'different', 'two', 'three', 'one', 'new', 'next', 'last',
  'america', 'china', 'india', 'europe', 'global', 'world', 'today', 'states', 'united',
]);

/**
 * Returns true if the phrase ends with what looks like an author or publisher name
 * appended to the title (e.g. "...Nishant Modak TFiR", "...USA 2026 Dataforest").
 * Strips pure year/number tokens before checking, and ignores common English words.
 */
function hasTrailingAuthorOrSite(phrase) {
  const parts = phrase.trim().split(/\s+/);
  if (parts.length < 3) return false;
  // Remove numeric tokens (years like 2026) AND punctuation-only tokens (& — ·)
  // from the tail. This handles patterns like "Sunil Pai & Matt Carrie" where "&"
  // would otherwise break consecutive name detection.
  const tail = parts.slice(-5).filter(w => !/^\d+$/.test(w) && /[a-zA-Z]/.test(w));
  if (tail.length < 2) return false;
  const last3 = tail.slice(-3);
  // Every remaining tail word must look like a proper name (Title Case or ALL-CAPS)
  // and must NOT be a common English word used in headlines.
  return last3.every(w => {
    if (AUTHOR_CHECK_EXCLUSIONS.has(w.toLowerCase())) return false;
    return /^[A-Z][a-z]+$/.test(w) || /^[A-Z]{2,}$/.test(w);
  });
}

/**
 * Classify search intent from organic titles.
 * Returns INFORMATIONAL | COMMERCIAL | NAVIGATIONAL | MIXED
 */
function classifyIntent(titles) {
  const scores = { INFORMATIONAL: 0, COMMERCIAL: 0, NAVIGATIONAL: 0 };
  for (const t of titles) {
    const lower = t.toLowerCase();
    for (const p of INTENT_PATTERNS.COMMERCIAL) if (p.test(lower)) scores.COMMERCIAL++;
    for (const p of INTENT_PATTERNS.NAVIGATIONAL) if (p.test(lower)) scores.NAVIGATIONAL++;
  }
  // Informational = remaining (how/what/why/guide/tutorial/intro/what is)
  scores.INFORMATIONAL = titles.length - scores.COMMERCIAL - scores.NAVIGATIONAL;

  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return winner; // INFORMATIONAL | COMMERCIAL | MIXED
}

// ─── Semantic Deduplication ─────────────────────────────────────────────────

function normalizeForDedup(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(text) {
  return new Set(normalizeForDedup(text).split(' ').filter((w) => w.length > 2));
}

/**
 * Returns true if two phrases overlap by more than threshold on content words.
 * Helps deduplicate topics that are the same story in different wording.
 */
function isNearDuplicate(a, b, threshold = 0.6) {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 || setB.size === 0) return false;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 && intersection / union >= threshold;
}

/**
 * Deduplicate candidates — keeps the phrase with the most organic results.
 */
function deduplicateCandidates(candidates) {
  const kept = [];
  for (const c of candidates) {
    const isDup = kept.some((k) => isNearDuplicate(c.phrase, k.phrase));
    if (!isDup) kept.push(c);
  }
  return kept;
}

// ─── Gap Detection ─────────────────────────────────────────────────────────

/**
 * Score content gap: thin content = opportunity.
 * "Thin" signals: short snippets, shallow H2 patterns ("what is", "intro"),
 * long-published articles (old dates), generic headlines.
 */
function detectContentGap(organic, snippets) {
  let gapScore = 0;

  // Short snippets = generic coverage
  const shortSnippetCount = snippets.filter((s) => s.split(' ').length < 25).length;
  gapScore += Math.min(shortSnippetCount, 5); // max +5

  // Titles with shallow framing = weak content
  const shallowPatterns = [
    /\b(what is|intro|introduction|beginner|getting started)\b/i,
    /\b(basics|fundamentals|first steps)\b/i,
    /\b(overview|summary|tldr)\b/i
  ];
  const titles = organic.map((o) => o.title || '');
  const shallowCount = titles.filter((t) => shallowPatterns.some((p) => p.test(t))).length;
  gapScore += Math.min(shallowCount, 4); // max +4

  // Old dates in results = outdated content to replace
  const oldCount = organic.filter((o) => {
    const d = o.date || '';
    // if date exists and is NOT in 2026 or recent months, count as old
    return d && !/2026|may|apr|mar/i.test(d);
  }).length;
  if (oldCount > 2) gapScore += 3; // +3 if 3+ old articles

  // Return gapScore 0-12
  return Math.min(gapScore, 12);
}

// ─── Deep Research ────────────────────────────────────────────────────────────

/**
 * Fire multiple search angles for a topic to gather rich context.
 */
async function deepResearchTopic(phrase) {
  const queries = [
    { q: phrase, label: 'primary' },
    { q: `latest ${phrase} this week`, label: 'news' },
    { q: `${phrase} best practices 2026`, label: 'practices' },
    { q: `${phrase} comparison guide`, label: 'comparison' },
    { q: `${phrase} implementation tutorial`, label: 'tutorial' },
    { q: `${phrase} trends 2026`, label: 'trends' }
  ];

  const results = await Promise.all(
    queries.map(({ q }) => callWebSearch(q).catch(() => ({ organic: [], related_searches: [] })))
  );

  const allOrganic = results.flatMap((r) => r.organic || []);
  const allRelated = results.flatMap((r) => r.related_searches || []);

  const organicTitles = allOrganic.map((o) => o.title || '');
  const organicUrls = allOrganic.map((o) => o.url || '');

  // Signal: high-authority count (major publications)
  const highAuthorityCount = organicUrls.filter((u) =>
    /forbes|medium|techcrunch|zdnet|gartner|idc|mckinsey|nih\.gov|wikipedia/i.test(u)
  ).length;

  // Signal: community sites (real practitioner interest)
  const communityCount = organicUrls.filter((u) =>
    /reddit|stackoverflow|github|dev\.to|lobsters|hacker\s*news/i.test(u)
  ).length;

  // Signal: recent news
  const recentOrganic = allOrganic.filter((o) => {
    const d = (o.date || '').toLowerCase();
    return /2026|may|apr|this week|yesterday|\d+\s*days?\s*ago|hours?\s*ago|just now/i.test(d);
  });

  // Related richness (sustained interest)
  const relatedRichness = allRelated.length;

  // Unique snippet diversity (content angles available)
  const uniqueSnippets = [...new Set(allOrganic.map((o) => (o.snippet || '').slice(0, 80)))].length;

  // Best/Top/Guide framing (high search intent)
  const bestTopCount = organicTitles.filter((t) =>
    /\b(best|top|guide|how to|tutorial|introduction)\b/i.test(t)
  ).length;

  // 2026 mentions (trend alignment)
  const y2026Count = organicTitles.filter((t) => /2026/.test(t)).length;

  // Intent classification (informational vs commercial vs mixed)
  const intent = classifyIntent(organicTitles);

  // News headline detection
  const isNews = isNewsHeadline(phrase);
  const hasAuthor = hasTrailingAuthorOrSite(phrase);

  // Content gap score (0-12: thin content = opportunity)
  const topSnippets = allOrganic.slice(0, 6).map((o) => o.snippet || '').filter(Boolean);
  const gapScore = detectContentGap(allOrganic, topSnippets);

  // Competitor titles for context
  const competitorTitles = organicTitles.slice(0, 8);

  // Q&A snippets (people-also-ask style)
  const questionSnippets = allOrganic
    .map((o) => o.snippet || '')
    .filter((s) => s.includes('?'))
    .slice(0, 4);

  return {
    phrase,
    // Signals
    totalOrganic: allOrganic.length,
    relatedRichness,
    highAuthorityCount,
    communityCount,
    recentOrganicCount: recentOrganic.length,
    uniqueSnippets,
    bestTopCount,
    y2026Count,
    intent,
    isNewsHeadline: isNews,
    hasTrailingAuthorOrSite: hasAuthor,
    gapScore,           // 0-12: higher = bigger gap/opportunity
    // Content for LLM
    competitorTitles,
    questionSnippets,
    topSnippets
  };
}

// ─── Main Scoring Function ──────────────────────────────────────────────────

/**
 * Score and rank topic candidates via MiniMax LLM using all research signals.
 *
 * @param {object[]} candidates — array of { phrase, source_seed, signal_value }
 * @param {number} topN — how many to deep-research (default 10)
 */
async function scoreAndRankCandidates(candidates, topN = 10) {
  const top = candidates.slice(0, topN);
  console.log('[TopicScore] Deep-researching candidates via MiniMax...');
  console.log(`[TopicScore] Candidates before dedup: ${top.length}`);

  // Semantic dedup before research — saves API calls and reduces diluted voting
  const deduped = deduplicateCandidates(top);
  console.log(`[TopicScore] After semantic dedup: ${deduped.length} candidates`);

  // Deep research all candidates in parallel
  const enriched = await Promise.all(deduped.map((c) => deepResearchTopic(c.phrase)));

  // Attach original candidate data — use deduped[i] (not top[i]) so indices stay aligned
  enriched.forEach((e, i) => {
    e.source_seed = deduped[i]?.source_seed || '';
    e.signal_value = deduped[i]?.signal_value || 50;
  });

  // Log signals for each candidate
  console.log('[TopicScore] Research signals:');
  enriched.forEach((e, i) => {
    console.log(`  [${i + 1}] "${e.phrase}"`);
    console.log(`       intent=${e.intent} | gapScore=${e.gapScore}/12 | totalOrganic=${e.totalOrganic} | related=${e.relatedRichness} | recentNews=${e.recentOrganicCount} | newsHeadline=${e.isNewsHeadline ? 'YES-REJECT' : 'ok'} | hasAuthor=${e.hasTrailingAuthorOrSite ? 'YES-REJECT' : 'ok'}`);
  });

  // Build scoring prompt with full signals
  const candidatesBlock = enriched
    .map((e, i) => {
      const snippets = e.topSnippets.join('\n    - ');
      const competitors = e.competitorTitles.join('\n    - ');
      const questions = e.questionSnippets.join('\n    - ');
      return `${i + 1}. "${e.phrase}"
  Seed: ${e.source_seed}
  Intent: ${e.intent}
  Signals — totalOrganic:${e.totalOrganic} | relatedRichness:${e.relatedRichness} | recentNews:${e.recentOrganicCount} | y2026Mentions:${e.y2026Count} | bestTopFraming:${e.bestTopCount} | authoritySites:${e.highAuthorityCount} | communitySites:${e.communityCount} | contentGap:${e.gapScore}/12 | newsHeadline:${e.isNewsHeadline} | hasAuthor:${e.hasTrailingAuthorOrSite}
  Top snippets:
    - ${snippets || '(none)'}
  ${competitors ? `Competitor titles:\n    - ${competitors}` : ''}
  ${questions ? `Q&A snippets:\n    - ${questions}` : ''}`;
    })
    .join('\n\n');

  const scoringPrompt = `You are a senior content strategist for Co-Ventech, a B2B software consultancy specializing in QA automation, DevOps, cybersecurity, and AI integration. Your audience: senior software engineers, tech leads, engineering managers, and CTOs.

Your job: Pick the ONE best topic for a high-SEO-performance blog post. We publish ADVANCED technical content — knowledge base articles, framework deep-dives, AI model coverage, library comparisons, and architecture guides that working engineers actually want to read.

**HIGHEST-PRIORITY TOPIC STYLES (these are the kind we want to lead with):**

A) AGENTIC / MULTI-AGENT / AUTONOMOUS AGENT content — the hottest 2026 angle:
- "How Multi-Agent Systems Impact Product Design"
- "The Agentic DevOps Pipeline That Cuts QA Time by 60%"
- "Why Your Current AI Automation Strategy is Failing & How Agents Fix It"
- "How to Build Agentic Workflows: Moving Beyond Basic LLM Chatbots"
- "5 Critical Benefits of Autonomous Agents for Scaling SaaS Infrastructure"

B) FRAMEWORK / LIBRARY deep-dives:
- "How to use X in production", "Understanding X internals", "X vs Y — which to choose"
- "What changed in React 19", "Breaking changes in TypeScript 6"

C) TUTORIAL / HOW-TO with concrete outcomes:
- "A practical guide to X", "Step-by-step X for engineers", "Building X from scratch"
- Topics with measurable outcomes ("cuts X by 60%", "saves Y hours", "scales to Z users")

D) AI / LLM technical depth:
- "Comparing GPT-5 vs Claude 4.5 for code generation", "RAG patterns that actually work"
- "Building agents with MCP", "Vector DB comparison for production RAG"
- "Fine-tuning vs prompt engineering — when to use what"

E) ARCHITECTURE / PATTERNS:
- "Event-driven architecture in 2026", "Microservices vs monolith — when to choose what"
- "Multi-agent orchestration patterns", "CQRS at scale"

F) TOOLING COMPARISONS (concrete, specific):
- "Playwright vs Cypress in 2026", "Bun vs Node performance benchmarks"
- "LangChain vs LangGraph vs CrewAI", "Postgres vs MongoDB for X use case"

G) SECURITY / DevOps / Performance:
- "CVE-2026-... analysis", "Kubernetes security hardening", "Zero-trust in practice"
- "Profiling Node.js in production", "Distributed tracing with OpenTelemetry"

H) PROBLEM-SOLUTION FRAMING (highly engaging for senior engineers):
- "Why X is failing and how Y fixes it"
- "Common pitfalls when building X"
- "Production-ready X: what nobody tells you"

**WHAT WE DO NOT PUBLISH (REJECT regardless of signals):**
- News headlines / event recaps: "It's been a big week for X", "X in 2026: what to expect", "Latest X news today", "X is set to dominate", "X announces Y"
- Generic hype: "Get ready for the revolution", "Everything you need to know about X"
- Commercial listicles: "Top 9 web development companies", "10 best X services for your business" (NOT "5 Critical Benefits of X" where X is a technical concept — that IS valid)
- Vague Q&A: "Looking for X recommendations", "Need help with X", "What's the best X for me", "Are X the Future of Y"
- Job / career content: "X jobs", "X salary", "X interview questions", "X career path"
- Consumer / non-technical: "X near me", "X for free", "X download", "X for beginners" (we target experienced engineers)
- First-person blog posts: "I tried X for 30 days", "My honest review of X"
- Reddit-style suffixes: "X : r/programming", "X subreddit"

**GRADING RUBRIC (apply strictly):**

A topic is EXCEPTIONAL (score 80-100) only if ALL of these hold:
- Title is a tutorial / guide / comparison / deep-dive / problem-solution (NOT a listicle, news, or vague Q&A)
- References specific technology: framework name, language, library, AI model, tool, protocol, or technical concept (e.g. "multi-agent systems", "MCP", "RAG", "Kubernetes", "Playwright")
- INFORMATIONAL or MIXED intent
- gapScore >= 6 (real opportunity to add depth)
- totalOrganic >= 5 (proven search interest)
- BONUS (does not change grade but lifts score within band): specific outcome/metric ("cuts by 60%"), specific tool/framework name, problem-solution framing, agentic/AI angle, production/architecture depth

A topic is STRONG (score 60-79) if:
- Title is technical and specific (mentions a tool/framework/library/AI concept)
- Has clear informational value
- gapScore >= 4
- totalOrganic >= 3

A topic is MEDIUM (score 40-59) if:
- Has SOME technical content but is broad, generic, or lacks specificity
- Mixed signals

A topic is WEAK (score 20-39) if:
- Vague or generic title
- No specific technology reference
- High competition with thin differentiation

A topic is REJECT (score 0-19) if:
- News headline style
- "Top N X companies" / "N best services" / commercial listicle
- Vague Q&A / "looking for X"
- Job / career / salary content
- Non-technical consumer content
- First-person blog / "my review"
- NAVIGATIONAL intent
- totalOrganic < 3 (zero search proof)

**SPECIFIC PATTERNS THAT LIFT SCORE WITHIN A GRADE BAND:**
- Agentic / multi-agent / autonomous agent angle (+5-10 within band)
- Specific tool/framework name mentioned (+5 within band)
- Concrete outcome / metric / number in title (+5 within band)
- Problem-solution framing ("Why X is failing", "How Y fixes it") (+5 within band)
- Production / architecture / at-scale framing (+3-5 within band)
- Tutorial / how-to / step-by-step framing (+3-5 within band)

**GOLDEN RULES:**
- Agentic / multi-agent / RAG / MCP topic with specific use case + gapScore >4 = EXCEPTIONAL
- Tutorial / comparison / how-to + specific tech name + gapScore >4 = EXCEPTIONAL
- News headline style = REJECT (even with high signals)
- Trailing author/publisher suffix ("...Nishant Modak TFiR") = REJECT
- Vague title with no specific tech mentioned = WEAK at best
- "Top 9 X companies" / "10 best X services" = REJECT (commercial listicle)
- "5 Critical Benefits of [technical concept]" = ALLOWED (this is a valid technical deep-dive if the subject is a specific tech concept)

Candidates:
${candidatesBlock}

Return ONLY raw JSON (no markdown, no prose):
{
  "reasoning": "2-3 sentences: why the winner was chosen and how it beats alternatives on the technical / specificity rubric",
  "picked_index": 1,
  "scores": [
    { "index": 1, "score": 0-100, "grade": "EXCEPTIONAL|STRONG|MEDIUM|WEAK|REJECT", "reason": "1 sentence explaining the score" },
    ...
  ]
}`;

  const raw = await minimaxChat(scoringPrompt, 3500, 120000);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(first, last + 1));
  } catch (err) {
    console.warn('[TopicSelector] parse failed, fallback to highest gapScore + recentOrganic:', cleaned.slice(0, 300));
    const fallback = enriched.sort((a, b) =>
      (b.gapScore + b.recentOrganicCount * 2) - (a.gapScore + a.recentOrganicCount * 2)
    )[0];
    parsed = {
      picked_index: enriched.indexOf(fallback) + 1,
      reasoning: 'Fallback (parse failed)',
      scores: enriched.map((e, i) => ({ index: i + 1, score: e.gapScore + e.recentOrganicCount * 2, grade: 'WEAK', reason: 'Fallback' }))
    };
  }

  const pickedIdx = Number(parsed.picked_index) || 1;
  let picked = enriched[pickedIdx - 1] || enriched[0];

  // Helper: reject a candidate and replace it with the best alternative.
  // Removes the rejected entry from enriched so the winners list stays clean
  // (shows 4 topics instead of a duplicate 5th).
  function rejectAndReplace(reason, filterFn) {
    const alternatives = enriched.filter((e) => e !== picked && filterFn(e) && e.totalOrganic >= 3);
    if (alternatives.length === 0) return;
    const bestAlt = alternatives.sort((a, b) =>
      (b.gapScore + b.recentOrganicCount * 2) - (a.gapScore + a.recentOrganicCount * 2)
    )[0];
    console.warn(`[TopicSelector] ${reason} — removing "${picked.phrase}"`);
    console.log(`[TopicSelector] Replaced with: "${bestAlt.phrase}"`);
    // Remove the rejected topic from winners — shows 4 clean topics, no duplicate
    const rejectedIdx = enriched.indexOf(picked);
    if (rejectedIdx !== -1) enriched.splice(rejectedIdx, 1);
    // Replace picked with the actual alternative object (no mutation)
    picked = bestAlt;
  }

  // Reject navigational topics even if LLM picked one
  if (picked.intent === 'NAVIGATIONAL') {
    rejectAndReplace('NAVIGATIONAL intent', (e) => e.intent !== 'NAVIGATIONAL');
  }

  // Reject news headline topics even if LLM picked one — prefer guide/comparison style
  if (picked.isNewsHeadline) {
    rejectAndReplace('News headline style detected', (e) => !e.isNewsHeadline);
  }

  // Reject topics with trailing author/publisher names
  if (picked.hasTrailingAuthorOrSite) {
    rejectAndReplace('Trailing author/publisher name detected', (e) => !e.hasTrailingAuthorOrSite);
  }

  const scored = (parsed.scores || []).sort((a, b) => b.score - a.score);

  return {
    winners: enriched,
    picked,
    reasoning: parsed.reasoning || '',
    allScores: scored
  };
}

module.exports = { scoreAndRankCandidates };