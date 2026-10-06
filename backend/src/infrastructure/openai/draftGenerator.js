const OpenAI = require('openai');
const { buildBlogResearchPrompt } = require('./promptBuilder');

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1) return null;
  return JSON.parse(s.slice(first, last + 1));
}

function countWordsMarkdown(md) {
  if (!md) return 0;
  const stripped = String(md).replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\[\]()|-]/g, ' ');
  return stripped.split(/\s+/).filter(Boolean).length;
}

const MAX_REVISION_BODY_CHARS = 48000;
const MIN_WORDS = Math.max(400, Number(process.env.BLOG_MIN_WORDS) || 1200); // default 1200; set BLOG_MIN_WORDS=1300 for production
const MAX_DRAFT_ATTEMPTS = Math.max(1, Number(process.env.BLOG_DRAFT_MAX_ATTEMPTS) || 3);
const EDITORIAL_POLISH_ENABLED = !['0', 'false', 'no', 'off'].includes(
  String(process.env.BLOG_EDITORIAL_POLISH ?? 'true').toLowerCase()
);
const EDITORIAL_POLISH_MAX_ATTEMPTS = Math.max(1, Number(process.env.BLOG_EDITORIAL_POLISH_MAX_ATTEMPTS) || 2);
const EXPANDER_MAX_ATTEMPTS = Math.max(1, Number(process.env.BLOG_EXPANDER_MAX_ATTEMPTS) || 2);
const DRAFT_MODEL = String(process.env.OPENAI_DRAFT_MODEL || 'gpt-4.1').trim();
const DRAFT_MAX_TOKENS = Math.max(3000, Number(process.env.OPENAI_DRAFT_MAX_TOKENS) || 20000);

const AI_SPEAK_PATTERNS = [
  /\bin today's (fast-paced|rapidly evolving|digital) (world|landscape)\b/i,
  /\blet'?s dive (in|into)\b/i,
  /\bit is important to note\b/i,
  /\bin conclusion\b/i,
  /\bthis article explores\b/i,
  /\bleverage\b/i
];

const REPETITION_IGNORE = new Set([
  'fetching',
  'rendering',
  'server',
  'client',
  'request',
  'response',
  'api',
  'apis'
]);

function normalizeToken(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function keywordStopTokens(pk) {
  const raw = String(pk || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(normalizeToken)
    .filter((t) => t && t.length >= 4);
  const stop = new Set(raw);
  for (const t of raw) {
    if (t.endsWith('s') && t.length > 5) stop.add(t.slice(0, -1));
    else if (!t.endsWith('s')) stop.add(`${t}s`);
  }
  return [...stop];
}

function repeatedTokenFlags(md, pk) {
  const stop = new Set(keywordStopTokens(pk));
  const toks = String(md || '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length >= 5 && !stop.has(t) && !REPETITION_IGNORE.has(t));
  if (!toks.length) return [];
  const counts = new Map();
  toks.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
  const repRatio = MIN_WORDS <= 900 ? 0.035 : 0.02;
  const limit = Math.max(15, Math.floor(toks.length * repRatio));
  return [...counts.entries()]
    .filter(([, c]) => c > limit)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w, c]) => `${w}(${c})`);
}

function hasMarkdownTable(md) {
  const s = String(md || '');
  return /\|.+\|\n\|[-:\s|]+\|/m.test(s);
}

function hasCodeFence(md) {
  return /```[a-zA-Z0-9_-]*\n[\s\S]*?```/.test(String(md || ''));
}

function hasVisualAid(md) {
  const s = String(md || '').toLowerCase();
  return s.includes('```mermaid') || s.includes('chart') || s.includes('diagram');
}

function hasMermaidFlow(md) {
  return /```mermaid[\s\S]*?\b(graph|flowchart)\b/i.test(String(md || ''));
}

function hasMermaidPie(md) {
  return /```mermaid[\s\S]*?\bpie\b/i.test(String(md || ''));
}

function topicNeedsPie(pk) {
  const s = String(pk || '').toLowerCase();
  return (
    s.includes(' vs ') ||
    s.includes('versus') ||
    s.includes('comparison') ||
    s.includes('compare') ||
    s.includes('market share')
  );
}

function countH2(md) {
  const m = String(md || '').match(/^##\s+/gm);
  return m ? m.length : 0;
}

function hasAllSectionContracts(md) {
  const s = String(md || '').toLowerCase();
  const needed = ['pitfalls', 'anti-pattern', 'decision checklist', 'sources'];
  return needed.filter((k) => s.includes(k)).length >= 3;
}

function needsExpansion(issues) {
  return issues.some(
    (x) =>
      x.startsWith('Body too short:') ||
      x.includes('Missing a visual aid section') ||
      x.includes('Not enough section depth') ||
      x.includes('Missing required expert sections')
  );
}

async function expandDraftForCoverage(client, pk, draft, issues) {
  const prompt = `Expand and upgrade this technical article JSON so it passes strict quality checks.

Required fixes:
${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}

Hard constraints:
- Keep exact JSON schema and keys.
- Keep title/meta/h1 intent and target_keyword = "${pk}".
- Increase body_markdown to at least ${MIN_WORDS} words.
- Add heading exactly "## Visual aid" and include one Mermaid block under it.
- Include one Mermaid flow diagram (graph/flowchart). If topic is comparative, include one Mermaid pie chart too.
- Ensure sections for pitfalls/anti-patterns, decision checklist, and sources exist.
- Keep at least one markdown comparison table and one practical code block.
- Avoid generic filler and avoid repeating sentence templates.
- Use concrete, source-grounded claims and avoid unverifiable hype.
- CRITICAL: Expand body_markdown to AT LEAST ${MIN_WORDS} words. Add real depth — do not pad with filler. Each H2 section must be 140+ words. If still short, add more subsections, examples, or edge cases.

Return ONLY valid JSON.

Current JSON:
${JSON.stringify(draft)}`;

  const res = await client.chat.completions.create({
    model: DRAFT_MODEL,
    max_tokens: DRAFT_MAX_TOKENS,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a principal editor improving a technical draft for publication.' },
      { role: 'user', content: prompt }
    ]
  });
  return extractJsonObject(res.choices[0]?.message?.content || '');
}

function evaluateDraftQuality(parsed, pk) {
  const issues = [];
  const body = String(parsed?.body_markdown || '');
  const words = countWordsMarkdown(body);

  if (!parsed || typeof parsed !== 'object') issues.push('Draft is not a JSON object');
  if (!String(parsed?.title || '').trim()) issues.push('Missing title');
  if (!String(parsed?.h1 || '').trim()) issues.push('Missing h1');
  if (!String(parsed?.meta_description || '').trim()) issues.push('Missing meta_description');
  if (!String(parsed?.slug || '').trim()) issues.push('Missing slug');
  if (words < MIN_WORDS) issues.push(`Body too short: ${words} words (need >= ${MIN_WORDS})`);
  if (countH2(body) < 6) issues.push('Not enough section depth (need at least 6 H2 sections)');
  if (!hasMarkdownTable(body)) issues.push('Missing at least one markdown comparison table');
  if (!hasCodeFence(body)) issues.push('Missing at least one implementation code snippet');
  if (!hasVisualAid(body)) issues.push('Missing a visual aid section (chart or diagram)');
  if (!hasMermaidFlow(body)) issues.push('Missing a Mermaid flow diagram (graph/flowchart) for process clarity');
  if (topicNeedsPie(pk) && !hasMermaidPie(body)) {
    issues.push('Comparison topic requires one Mermaid pie chart for distribution/tradeoff view');
  }
  if (!hasAllSectionContracts(body)) {
    issues.push('Missing required expert sections (pitfalls/anti-patterns, decision checklist, or sources)');
  }
  if ((parsed?.faq || []).length < 4) issues.push('FAQ must have at least 4 items');

  const pkWords = new Set(pk.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  const metaLower = String(parsed.meta_description || '').toLowerCase();
  const metaWords = new Set(metaLower.split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  const h1Lower = String(parsed.h1 || '').toLowerCase();
  const h1Words = new Set(h1Lower.split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  const metaCovered = [...pkWords].filter(w => metaWords.has(w));
  const h1Covered = [...pkWords].filter(w => h1Words.has(w));
  if (pkWords.size > 0 && metaCovered.length < Math.ceil(pkWords.size * 0.6)) {
    issues.push(`meta_description must include the primary keyword (missing: ${[...pkWords].filter(w => !metaWords.has(w)).join(', ')})`);
  }
  if (pkWords.size > 0 && h1Covered.length < Math.ceil(pkWords.size * 0.6)) {
    issues.push(`h1 must include the primary keyword naturally (missing: ${[...pkWords].filter(w => !h1Words.has(w)).join(', ')})`);
  }
  const repeated = repeatedTokenFlags(body, pk);
  if (repeated.length) {
    issues.push(`Potential repetitive wording detected: ${repeated.join(', ')}`);
  }
  const aiSpeakHits = AI_SPEAK_PATTERNS.filter((p) => p.test(body)).length;
  if (aiSpeakHits > 1) {
    issues.push('Tone sounds generic/AI-like in multiple places; rewrite with concrete expert voice');
  }
  return { words, issues };
}

async function editorialPolishDraft(client, pk, draft, ctx, feedback = '') {
  const prompt = `Rewrite the article JSON to sound like it was written by a senior practitioner with hands-on delivery experience.

Requirements:
- Keep the exact same JSON schema and keys.
- Preserve factual intent and primary keyword coverage.
- Keep table(s), code block(s), FAQ, and visual aid section.
- Remove repetitive or templated phrasing.
- Prefer concrete claims, caveats, and implementation details over generic advice.
- Use tighter, varied sentence rhythm; avoid "AI-speak" clichés.
- Keep body length >= ${MIN_WORDS} words.
- Keep target_keyword exactly "${pk}".
- Keep strong factual grounding with references to practical implementation details.

Context signal:
- Target keyword: ${pk}
- Trend score: ${ctx.trendScore}

Draft JSON:
${JSON.stringify(draft)}

${feedback ? `Additional fixes needed:\n${feedback}` : ''}

Return ONLY valid JSON.`;

  const res = await client.chat.completions.create({
    model: DRAFT_MODEL,
    max_tokens: DRAFT_MAX_TOKENS,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a principal technical editor and former staff engineer.' },
      { role: 'user', content: prompt }
    ]
  });
  return extractJsonObject(res.choices[0]?.message?.content || '');
}

/**
 * @param {object} revision Optional: { previousDraft, score, issues, suggestions } after failed SEO audit
 * @returns {Promise<object>} Parsed draft JSON
 */
async function generateBlogDraftJson(apiKey, ctx, revision) {
  const client = new OpenAI({ apiKey });
  const researchBlock = buildBlogResearchPrompt(ctx);
  const pk = String(ctx.targetKeyword || '').trim();

  const system = `You are a principal engineer and technical editor. Reply with a single JSON object only (no markdown fences).
The JSON must have exactly these keys:
- title (string)
- slug (string, lowercase-kebab-case, no spaces)
- meta_description (string, <= 155 chars, compelling) — MUST include the full primary keyword phrase as a substring (case-insensitive match is OK)
- h1 (string) — MUST include the primary keyword phrase naturally
- body_markdown (string, GitHub-flavored Markdown, at least ${MIN_WORDS} English words in the article body alone, not counting FAQ; practical examples)
- faq (array of { "question": string, "answer": string }, at least 4 items)
- CRITICAL: Never put FAQ content inside body_markdown. Do NOT include headings "## FAQ", "## Frequently asked questions", or paste faq JSON into the markdown. FAQ exists only in the faq array.
- For "Decision checklist", use normal markdown bullets like "- First item" — never use task-list syntax "- [ ] item" (square brackets look broken on many readers).
- target_keyword (string)
- secondary_keywords (array of strings, 6-12 items)

SEO hard requirements for body_markdown:
- The first ~120 words (opening section before the first ## heading is fine) MUST contain the full primary keyword phrase at least once (natural wording).
- Include at least 6 H2 sections (##).
- Include at least one markdown table with actionable tradeoffs.
- Include at least one code block with practical implementation details.
- Include at least one visual aid section (Mermaid diagram or chart specification).
- Include one Mermaid flow diagram using "graph" or "flowchart" syntax.
- If the primary keyword is a comparison topic (contains vs/versus/compare), include one Mermaid pie chart.
- Include a section titled "Pitfalls and anti-patterns".
- Include a section titled "Decision checklist".
- Include a section titled "Sources" with 3-6 bullet links (real URLs, not placeholders).
- Sources must be real, clickable URLs relevant to the exact topic (docs, benchmarks, vendor docs, or trusted engineering articles).
- Section depth guidance:
  - Intro: 120-180 words
  - Core H2 sections: 140-220 words each
  - FAQ answers: 80-120 words each
- The final section MUST end with a clear call-to-action: invite the reader to take a next step (e.g. assessment, pilot, or "Talk to Co-Ventech") and mention /contact or a concrete action — not vague "learn more" only.
- Avoid repetitive phrases, repeated sentence templates, and generic filler.`;

  let user = `${researchBlock}

Now produce ONLY the JSON object described in the system message.
target_keyword must be exactly: "${pk}"
secondary_keywords should include useful variants from the related list and PAA themes.

IMPORTANT word count requirement: body_markdown must be AT LEAST ${MIN_WORDS} words (never fewer). If the draft is too short, add more sections, deeper explanations, real examples, and edge cases — do NOT pad with filler.`;

  if (revision && revision.previousDraft && typeof revision.previousDraft === 'object') {
    const prev = revision.previousDraft;
    const body = String(prev.body_markdown || '');
    const bodySnippet =
      body.length <= MAX_REVISION_BODY_CHARS
        ? body
        : `${body.slice(0, MAX_REVISION_BODY_CHARS)}\n\n[... middle truncated for length ...]\n\n${body.slice(-6000)}`;
    const issues = Array.isArray(revision.issues) ? revision.issues : [];
    const suggestions = Array.isArray(revision.suggestions) ? revision.suggestions : [];
    user = `${researchBlock}

The previous draft FAILED an automated SEO audit (score ${Number(revision.score) || 0}/100, need >= 70). Rewrite the entire article as NEW JSON that fixes every issue below. Do not copy weak sentences verbatim — improve structure and depth.

Issues (fix all):
${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}

Suggestions:
${suggestions.map((x, i) => `${i + 1}. ${x}`).join('\n')}

Previous draft (for reference — produce a full replacement JSON object, same schema):
${JSON.stringify({
      title: prev.title,
      slug: prev.slug,
      meta_description: prev.meta_description,
      h1: prev.h1,
      body_markdown: bodySnippet,
      faq: prev.faq,
      secondary_keywords: prev.secondary_keywords
    })}

Return ONLY the improved JSON. target_keyword must still be exactly: "${pk}"`;
  }

  let qualityFeedback = '';
  let parsed = null;
  let lastIssues = [];
  console.log(
    `[Draft] OpenAI generation started | keyword="${pk}" | model=${DRAFT_MODEL} | maxAttempts=${MAX_DRAFT_ATTEMPTS} | minWords=${MIN_WORDS}`
  );
  if (revision && revision.previousDraft) {
    console.log(`[Draft] Revision mode enabled (previous score=${Number(revision.score) || 0}).`);
  }

  for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt++) {
    console.log(`[Draft] OpenAI attempt ${attempt}/${MAX_DRAFT_ATTEMPTS}...`);
    const attemptUser = qualityFeedback ? `${user}\n\n${qualityFeedback}` : user;
    const response = await client.chat.completions.create({
      model: DRAFT_MODEL,
      max_tokens: DRAFT_MAX_TOKENS,
      temperature: attempt === 1 ? 0.45 : 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: attemptUser }
      ]
    });

    const raw = response.choices[0]?.message?.content || '';
    try {
      parsed = extractJsonObject(raw);
    } catch (e) {
      lastIssues = [`Draft JSON parse failed: ${e.message}`];
      console.warn(`[Draft] Attempt ${attempt}: invalid JSON (${e.message}).`);
      qualityFeedback = `\nThe previous output was invalid JSON. Return ONLY valid JSON with the exact required keys.`;
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      lastIssues = ['Draft JSON missing or invalid'];
      console.warn(`[Draft] Attempt ${attempt}: response was not a JSON object.`);
      qualityFeedback = `\nThe previous output was not a valid JSON object. Return ONLY valid JSON with the exact required keys.`;
      continue;
    }

    const quality = evaluateDraftQuality(parsed, pk);
    parsed._word_estimate = quality.words;
    if (!quality.issues.length) {
      console.log(`[Draft] Attempt ${attempt}: quality passed (~${quality.words} words).`);
      if (!EDITORIAL_POLISH_ENABLED) return parsed;
      let polished = parsed;
      let polishFeedback = '';
      for (let i = 1; i <= EDITORIAL_POLISH_MAX_ATTEMPTS; i++) {
        console.log(`[Draft] Editorial polish ${i}/${EDITORIAL_POLISH_MAX_ATTEMPTS}...`);
        try {
          const candidate = await editorialPolishDraft(client, pk, polished, ctx, polishFeedback);
          const after = evaluateDraftQuality(candidate, pk);
          candidate._word_estimate = after.words;
          if (!after.issues.length) {
            console.log(`[Draft] Editorial polish ${i}: passed (~${after.words} words).`);
            return candidate;
          }
          console.warn(`[Draft] Editorial polish ${i}: still failing (${after.issues.join(' | ')}).`);
          polished = candidate;
          polishFeedback = after.issues.map((x, idx) => `${idx + 1}. ${x}`).join('\n');
        } catch (err) {
          console.warn(`[Draft] Editorial polish ${i} failed: ${err.message}`);
          polishFeedback = `Polish attempt failed: ${err.message}`;
        }
      }
      return polished;
    }
    console.warn(`[Draft] Attempt ${attempt}: quality issues -> ${quality.issues.join(' | ')}`);
    if (needsExpansion(quality.issues)) {
      let expanded = parsed;
      let expandedQuality = quality;
      for (let ei = 1; ei <= EXPANDER_MAX_ATTEMPTS; ei++) {
        console.log(`[Draft] Coverage expansion ${ei}/${EXPANDER_MAX_ATTEMPTS}...`);
        try {
          const candidate = await expandDraftForCoverage(client, pk, expanded, expandedQuality.issues);
          const qc = evaluateDraftQuality(candidate, pk);
          candidate._word_estimate = qc.words;
          if (!qc.issues.length) {
            console.log(`[Draft] Coverage expansion ${ei}: passed (~${qc.words} words).`);
            return candidate;
          }
          console.warn(`[Draft] Coverage expansion ${ei}: still failing (${qc.issues.join(' | ')})`);
          expanded = candidate;
          expandedQuality = qc;
        } catch (err) {
          console.warn(`[Draft] Coverage expansion ${ei} failed: ${err.message}`);
          // Continue outer retry flow with accumulated quality feedback.
          break;
        }
      }
      if (!expandedQuality.issues.length) return expanded;
      parsed = expanded;
      parsed._word_estimate = expandedQuality.words;
      lastIssues = expandedQuality.issues;
      qualityFeedback = `\nThe previous draft still missed required depth/coverage. Rewrite from scratch and fix ALL issues:\n${expandedQuality.issues
        .map((x, i) => `${i + 1}. ${x}`)
        .join('\n')}`;
      continue;
    }
    lastIssues = quality.issues;
    const wordIssue = quality.issues.find(x => x.startsWith('Body too short:'));
    const wordCountHint = wordIssue
      ? `\nThe most critical fix: the body is ${wordIssue.match(/(\d+)/)[1]} words but MUST be at least ${MIN_WORDS} words. Add real depth — more sections, more examples, more explanation. Do NOT repeat the same sentences.`
      : '';
    qualityFeedback = `\nThe previous draft did not meet quality requirements. Rewrite from scratch and fix ALL issues:\n${quality.issues
      .map((x, i) => `${i + 1}. ${x}`)
      .join('\n')}${wordCountHint}`;
  }

  if (parsed && typeof parsed === 'object') {
    parsed._word_estimate = countWordsMarkdown(parsed.body_markdown);
  }
  const reason = lastIssues.length ? ` Final quality issues: ${lastIssues.join(' | ')}` : '';
  throw new Error(`Draft generation failed to meet quality after ${MAX_DRAFT_ATTEMPTS} attempts.${reason}`);
}

module.exports = { generateBlogDraftJson, countWordsMarkdown };
