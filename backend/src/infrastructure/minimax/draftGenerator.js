/**
 * Blog draft generator using MiniMax /v1/chat/completions HTTP API.
 * Replaces OpenAI for up-to-date knowledge on trending tech topics.
 */
const { callWebSearch } = require('./minimaxClient');

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  // Strip thinking/reasoning blocks: <think> ...</think>  <reasoning>...</reasoning>  etc.
  // These always appear as self-contained blocks before the JSON output
  s = s
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .replace(/<cot>[\s\S]*?<\/cot>/gi, '')
    .replace(/<[\w]+>[\s\S]*?<\/[\w]+>/gi, (m) => {
      // Only strip blocks that look like thinking (no braces inside)
      if (m.includes('{') || m.includes('}')) return m;
      return '';
    })
    .trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || first >= last) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch (_) {
    return null;
  }
}

function countWordsMarkdown(md) {
  if (!md) return 0;
  const stripped = String(md).replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\[\]()|-]/g, ' ');
  return stripped.split(/\s+/).filter(Boolean).length;
}

const MIN_WORDS = Number(process.env.BLOG_MIN_WORDS) || 1100;
const MAX_DRAFT_ATTEMPTS = Math.max(1, Number(process.env.BLOG_DRAFT_MAX_ATTEMPTS) || 3);
const EXPANDER_MAX_ATTEMPTS = Math.max(1, Number(process.env.BLOG_EXPANDER_MAX_ATTEMPTS) || 2);

const AI_SPEAK_PATTERNS = [
  /\bin today's (fast-paced|rapidly evolving|digital) (world|landscape)\b/i,
  /\blet'?s dive (in|into)\b/i,
  /\bit is important to note\b/i,
  /\bin conclusion\b/i,
  /\bthis article explores\b/i,
  /\bleverage\b/i
];

const REPETITION_IGNORE = new Set([
  'fetching', 'rendering', 'server', 'client', 'request', 'response', 'api', 'apis'
]);

function normalizeToken(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function keywordStopTokens(pk) {
  return String(pk || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(normalizeToken)
    .filter((t) => t && t.length >= 4);
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
  const limit = Math.max(10, Math.floor(toks.length * 0.02));
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
  return s.includes(' vs ') || s.includes('versus') || s.includes('comparison') || s.includes('compare') || s.includes('market share');
}

function countH2(md) {
  const m = String(md || '').match(/^##\s+/gm);
  return m ? m.length : 0;
}

function hasAllSectionContracts(md) {
  const s = String(md || '').toLowerCase();
  return ['pitfalls', 'anti-pattern', 'decision checklist', 'sources'].filter((k) => s.includes(k)).length >= 3;
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

async function minimaxChat(prompt, maxTokens = 2000) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const apiHost = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
  if (!apiKey) throw new Error('MINIMAX_API_KEY is required');

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
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MiniMax API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function expandDraftForCoverage(pk, draft, issues) {
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

Return ONLY valid JSON.

Current JSON:
${JSON.stringify(draft)}`;

  const raw = await minimaxChat(prompt, 3000);
  return extractJsonObject(raw);
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
  if (pk && !String(parsed.meta_description || '').toLowerCase().includes(pk.toLowerCase())) {
    issues.push('meta_description must include the full primary keyword');
  }
  if (pk && !String(parsed.h1 || '').toLowerCase().includes(pk.toLowerCase())) {
    issues.push('h1 must include the full primary keyword');
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

function buildBlogResearchPrompt(ctx) {
  const { targetKeyword, trendScore, competitors, peopleAlsoAsk, relatedKeywords, secondaryKeywordsFromTrends = [] } = ctx;

  const compLines = (competitors || [])
    .slice(0, 10)
    .map((c, i) => `${i + 1}. [${c.position}] ${c.title} — ${c.url}`)
    .join('\n');

  const paa = (peopleAlsoAsk || []).map((q, i) => `${i + 1}. ${q}`).join('\n');
  const rel = [...new Set([...(relatedKeywords || []), ...secondaryKeywordsFromTrends])]
    .filter(Boolean)
    .slice(0, 16)
    .join(', ');

  return `You are writing a technical deep-dive article for senior engineers and tech leads.

## Target
- Primary keyword: "${targetKeyword}"
- Google Trends rising signal (relative): ${trendScore}

## Competitors (top organic)
${compLines || '(none parsed)'}

## People Also Ask
${paa || '(none parsed)'}

## Related / secondary keyword ideas
${rel || '(none)'}

## Instructions
- Writing quality: editorial, concrete, and expert-level. Avoid fluffy intros, repeated claims, and generic filler.
- Tone: engineer-to-engineer; practical, specific, skeptical of hype; explain tradeoffs and failure modes.
- Style benchmark: premium engineering publications (Toptal-like depth and clarity), but original wording.
- Use short code/config examples where they clarify a point (YAML, bash, TypeScript, Python, SQL, or pseudo-code).
- Include at least one meaningful comparison table in Markdown.
- Include at least one code block that is directly relevant to implementation.
- Include one visual aid suggestion section in Markdown (diagram/chart idea) using either Mermaid or a clearly described chart spec.
- SEO: natural keyword use; answer PAA questions inside the narrative and FAQ.
- Do not invent fake statistics. If evidence is uncertain, explicitly say so and explain assumptions.
- Cite 3-6 real external sources (URLs from SERP competitors or well-known docs) in a "Sources" section.
- Length target for body_markdown: at least ${MIN_WORDS} words (not counting FAQ); prefer 1300-1900 words.
- SEO: meta description must contain the full primary keyword phrase; first ~120 words of the body must include it; end with a concrete CTA (assessment/pilot/contact with /contact or equivalent).
- Structure expectation:
  1) sharp problem framing
  2) architecture or mental model
  3) tradeoff comparison table
  4) implementation walkthrough (with code/config)
  5) pitfalls and anti-patterns
  6) decision checklist (plain bullet lines starting with "- ", not GitHub task checkboxes like "- [ ]")
  7) Sources
- FAQ belongs ONLY in the JSON "faq" array in the final output — do NOT add a "## FAQ" or "## Frequently asked questions" section inside body_markdown.
- For each major H2 section, follow this micro-structure when applicable:
  - What it is
  - Why it matters in production
  - When to use vs avoid
  - Common failure mode
  - Actionable takeaway
- Add explicit section-level depth:
  - Intro: 120-180 words
  - Core H2 sections: typically 140-220 words each
  - FAQ answers: 80-120 words each
- Avoid placeholder statements; every section should include at least one concrete implementation or architecture detail.

Output will be requested as JSON only in the next step; use this context to stay factual and structured.`;
}

/**
 * Generate a blog draft JSON using MiniMax M2.1 with fresh web-grounded knowledge.
 */
async function generateBlogDraftJson(apiKey, ctx, revision) {
  const pk = String(ctx.targetKeyword || '').trim();
  const researchBlock = buildBlogResearchPrompt(ctx);

  const system = `You are a principal engineer and technical editor. You MUST output EXACTLY one valid JSON object and nothing else. No thinking blocks, no text before or after, no markdown fences. Just the raw JSON starting with "{" and ending with "}".

Required JSON keys:
- title (string)
- slug (string, lowercase-kebab-case, no spaces)
- meta_description (string, <= 155 chars, MUST include the full primary keyword as a substring)
- h1 (string, MUST include the primary keyword naturally)
- body_markdown (string, GitHub-flavored Markdown, at least ${MIN_WORDS} English words in body, practical examples)
- faq (array of { "question": string, "answer": string }, at least 4 items — put ONLY in this array, nowhere in body)
- target_keyword (string)
- secondary_keywords (array of 6-12 strings)

SEO requirements for body_markdown:
- First ~120 words MUST contain the primary keyword.
- At least 6 H2 sections (##).
- At least one markdown comparison table with actionable tradeoffs.
- At least one code block with practical implementation.
- One Mermaid flow diagram (graph or flowchart syntax).
- If keyword contains vs/compare/comparison, add one Mermaid pie chart.
- Section "Pitfalls and anti-patterns".
- Section "Decision checklist" using plain "- " bullets (not "- [ ]").
- Section "Sources" with 3-6 real clickable URLs (docs, benchmarks, vendor docs).
- Final section must end with a concrete CTA (assessment/pilot/contact with /contact).
- No repetitive phrases, no generic filler.
- No "## FAQ" or FAQ content inside body_markdown — FAQ goes only in the faq array.

IMPORTANT: Output JSON ONLY. No commentary, no explanation, no thinking blocks. Start with "{" and end with "}".`;

  let user = `target_keyword: "${pk}"

competitors (top organic):
${(ctx.competitors || []).slice(0, 10).map((c, i) => `${i + 1}. ${c.title} — ${c.url}`).join('\n') || '(none)'}

related keywords:
${[...(ctx.relatedKeywords || []), ...(ctx.secondaryKeywordsFromTrends || [])].slice(0, 16).join(', ') || '(none)'}

Now output ONLY the JSON object described above. No text before or after.`;

  if (revision && revision.previousDraft && typeof revision.previousDraft === 'object') {
    const prev = revision.previousDraft;
    const body = String(prev.body_markdown || '');
    const bodySnippet = body.length <= 48000
      ? body
      : `${body.slice(0, 48000)}\n\n[... truncated ...]\n\n${body.slice(-6000)}`;
    const issues = Array.isArray(revision.issues) ? revision.issues : [];
    const suggestions = Array.isArray(revision.suggestions) ? revision.suggestions : [];
    user = `target_keyword: "${pk}"

FAILED previous attempt. Issues:
${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}

Rewrite the full JSON fixing ALL issues. Output ONLY the JSON.`;
  }

  let qualityFeedback = '';
  let parsed = null;
  let lastIssues = [];
  console.log(`[Draft] MiniMax generation | keyword="${pk}" | model=${process.env.MINIMAX_MODEL || 'MiniMax-M3'} | minWords=${MIN_WORDS}`);
  if (revision && revision.previousDraft) {
    console.log(`[Draft] Revision mode (previous score=${Number(revision.score) || 0}).`);
  }

  for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt++) {
    console.log(`[Draft] Attempt ${attempt}/${MAX_DRAFT_ATTEMPTS}...`);
    const attemptUser = qualityFeedback ? `${user}\n\n${qualityFeedback}` : user;
    const raw = await minimaxChat(`${system}\n\n${attemptUser}`, 3000);

    try {
      parsed = extractJsonObject(raw);
    } catch (e) {
      lastIssues = [`JSON parse failed: ${e.message}`];
      console.warn(`[Draft] Attempt ${attempt}: parse error — ${e.message}`);
      qualityFeedback = `\nReturn ONLY valid JSON with the exact required keys. No thinking blocks, no commentary, just the JSON.`;
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      lastIssues = ['Response was not a JSON object'];
      console.warn(`[Draft] Attempt ${attempt}: not a valid JSON object (raw: ${raw.slice(0, 100)})`);
      qualityFeedback = `\nReturn ONLY the JSON object. Do not include any text before or after the JSON.`;
      continue;
    }

    const quality = evaluateDraftQuality(parsed, pk);
    parsed._word_estimate = quality.words;
    if (!quality.issues.length) {
      console.log(`[Draft] Attempt ${attempt}: passed (~${quality.words} words)`);
      return parsed;
    }

    console.warn(`[Draft] Attempt ${attempt}: quality issues — ${quality.issues.join(' | ')}`);

    if (needsExpansion(quality.issues)) {
      let expanded = parsed;
      let expandedQuality = quality;
      for (let ei = 1; ei <= EXPANDER_MAX_ATTEMPTS; ei++) {
        console.log(`[Draft] Coverage expansion ${ei}/${EXPANDER_MAX_ATTEMPTS}...`);
        try {
          const candidate = await expandDraftForCoverage(pk, expanded, expandedQuality.issues);
          const qc = evaluateDraftQuality(candidate, pk);
          candidate._word_estimate = qc.words;
          if (!qc.issues.length) {
            console.log(`[Draft] Expansion ${ei}: passed (~${qc.words} words)`);
            return candidate;
          }
          console.warn(`[Draft] Expansion ${ei}: still failing (${qc.issues.join(' | ')})`);
          expanded = candidate;
          expandedQuality = qc;
        } catch (err) {
          console.warn(`[Draft] Expansion ${ei} failed: ${err.message}`);
          break;
        }
      }
      if (!expandedQuality.issues.length) return expanded;
      parsed = expanded;
      parsed._word_estimate = expandedQuality.words;
      lastIssues = expandedQuality.issues;
      qualityFeedback = `\nRewrite from scratch fixing ALL issues:\n${expandedQuality.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
      continue;
    }

    lastIssues = quality.issues;
    qualityFeedback = `\nRewrite from scratch fixing ALL issues:\n${quality.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
  }

  if (parsed && typeof parsed === 'object') {
    parsed._word_estimate = countWordsMarkdown(parsed.body_markdown);
  }
  const reason = lastIssues.length ? ` Issues: ${lastIssues.join(' | ')}` : '';
  throw new Error(`Draft failed after ${MAX_DRAFT_ATTEMPTS} attempts.${reason}`);
}

module.exports = { generateBlogDraftJson, countWordsMarkdown };