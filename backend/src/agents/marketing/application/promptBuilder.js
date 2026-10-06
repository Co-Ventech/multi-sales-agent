/**
 * Structured research prompt for the LLM (OpenAI).
 * Engineer-to-engineer tone; includes SERP + trend context.
 */
function buildBlogResearchPrompt(ctx) {
  const {
    targetKeyword,
    trendScore,
    competitors,
    peopleAlsoAsk,
    relatedKeywords,
    secondaryKeywordsFromTrends = []
  } = ctx;

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
- Length target for body_markdown: at least 1500 words (not counting FAQ); prefer 1600–2000 words.
- SEO: meta description must contain the full primary keyword phrase; first ~120 words of the body must include it; end with a concrete CTA (assessment/pilot/contact with /contact or equivalent).
- Structure expectation:
  1) sharp problem framing
  2) architecture or mental model
  3) tradeoff comparison table
  4) implementation walkthrough (with code/config)
  5) pitfalls and anti-patterns
  6) decision checklist (plain bullet lines starting with "- ", not GitHub task checkboxes like "- [ ]")
  7) Sources
- FAQ belongs ONLY in the JSON "faq" array in the final output — do NOT add a "## FAQ" or "## Frequently asked questions" section inside body_markdown (avoids duplicate FAQ in CMS that also renders structured FAQ).
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

module.exports = { buildBlogResearchPrompt };
