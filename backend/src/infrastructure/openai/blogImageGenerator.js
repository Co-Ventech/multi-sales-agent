const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

function clip(s, max) {
  return String(s || '')
    .trim()
    .slice(0, max);
}

function imageModelName() {
  return String(process.env.OPENAI_IMAGE_MODEL || 'dall-e-3').trim();
}

function defaultImageQuality(model) {
  const m = String(model || '').toLowerCase();
  if (m === 'dall-e-3') return 'hd';
  if (m === 'gpt-image-1') return 'high';
  return '';
}

function imageQuality(model) {
  return String(process.env.OPENAI_IMAGE_QUALITY || defaultImageQuality(model)).trim();
}

function imageStyle(model) {
  if (String(model).toLowerCase() !== 'dall-e-3') return '';
  return String(process.env.OPENAI_IMAGE_STYLE_MODE || 'vivid').trim();
}

/** GPT image models use different sizes and do not support `response_format` (always base64). */
function isGptImageModel(model) {
  return /^gpt-image-/i.test(String(model || '').trim());
}

const STOP = new Set(
  'the a an for and or to of in on at with from into by as is are was were vs best top new how what why when per vs'.split(
    ' '
  )
);

/** Map noisy location phrases to concepts so visuals stay on engineering, not skylines. */
function keywordForVisualTokens(keyword) {
  return String(keyword || '')
    .replace(/\bsilicon\s+valley\b/gi, 'tech industry hubs')
    .replace(/\bunited\s+states\b|\busa\b|\bu\.s\.\b/gi, '')
    .trim();
}

function topicTokens(keyword) {
  const normalized = keywordForVisualTokens(keyword);
  return String(normalized || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 8)
    .join(', ');
}

function plainExcerptFromMarkdown(md, max) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function extractH2Titles(md) {
  return [...String(md || '').matchAll(/^##\s+(.+)$/gm)]
    .map((m) => String(m[1] || '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

function cleanSectionTitle(s) {
  return String(s || '')
    .replace(/[`*_#]/g, '')
    .trim();
}

function hashSeed(...parts) {
  const s = parts.join('\0');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) >>> 0;
}

/** Rotates composition so heroes do not all look like the same generic cubes-and-gears scene. */
function pickVisualLane(seed) {
  const lanes = [
    'one focal cluster: a small hub where three simple modules meet with soft glowing links between them',
    'layered translucent platforms stacked shallowly, one layer brighter to suggest a critical path',
    'two minimal shapes linked by a smooth curved ribbon suggesting data or control flow',
    'a compact shield or curved arc framing one geometric core, suggesting safety or boundaries',
    'a short isometric "stage" with a single tall thin element (antenna, mast, or beacon) as the hero',
    'a stylized crane or hoist lifting one clean block — building or shipping metaphor, not busy construction',
    'a circular ring or lens partially surrounding one simple solid, suggesting scan, focus, or QA',
    'a branching fork with one path highlighted, suggesting decisions or routing',
    'stacked horizontal slabs like stable infrastructure tiers with one accent slab',
    'a small mesh of nodes with exactly one brighter pulse point, suggesting agents or distributed work',
    'a grid of equal cells with one cell lifted or glowing, suggesting isolation, bug, or hot spot',
    'a compact coil or spring shape beside a steady base, suggesting resilience or release of energy'
  ];
  return lanes[seed % lanes.length];
}

function pickAccent(seed) {
  const accents = ['lime', 'amber', 'coral', 'magenta', 'electric yellow', 'mint'];
  return accents[Math.floor(seed / 13) % accents.length];
}

function pickDiagramLane(seed, keyword) {
  const k = String(keyword || '').toLowerCase();
  if (k.includes(' vs ') || k.includes('versus') || k.includes('compare')) {
    return 'split-screen comparison card with two columns and a central tradeoff connector';
  }
  if (k.includes('workflow') || k.includes('pipeline') || k.includes('process')) {
    return 'step-by-step flow card with 4 connected stages and directional arrows';
  }
  if (k.includes('api') || k.includes('client') || k.includes('server')) {
    return 'client-server request flow card using 4 stacked boxes and arrows';
  }
  const lanes = [
    'layered architecture card with 3-4 horizontal tiers and one highlighted layer',
    'control-plane vs data-plane concept card with directional edges',
    'modular systems card with grouped blocks and one focal bottleneck indicator'
  ];
  return lanes[seed % lanes.length];
}

/**
 * Engineering-blog hero — Toptal-style: 3D isometric, dark ground, one clear idea tied to THIS topic.
 * @param {{ title: string, keyword: string, metaDescription?: string, bodyExcerpt?: string }} p
 */
function buildHeroImagePrompt(p) {
  const t = clip(p.title, 180);
  const k = clip(p.keyword, 160);
  const meta = clip(p.metaDescription, 220);
  const excerpt = clip(plainExcerptFromMarkdown(p.bodyExcerpt, 2000), 280);
  const tokens = topicTokens(p.keyword) || k;
  const seed = hashSeed(k, t, meta.slice(0, 80));
  const lane = pickVisualLane(seed);
  const diagramLane = pickDiagramLane(seed, k);
  const accent = pickAccent(seed);
  const h2s = extractH2Titles(p.bodyExcerpt || '');
  const style = String(process.env.OPENAI_IMAGE_STYLE || 'editorial-diagram').trim().toLowerCase();

  const topicLock = [
    'The illustration must feel specific to this article, not a generic tech stock scene.',
    `Core subject matter (interpret visually, no labels): concepts suggested by these terms: ${tokens}.`,
    meta ? `Article angle from summary (mood only, do not write this as text): ${meta}` : '',
    excerpt
      ? `Narrative hint from opening (visualize abstractly, no sentences in-image): ${excerpt}`
      : ''
  ]
    .filter(Boolean)
    .join(' ');

  return [
    'Wide 16:9 blog cover in the visual language of a premium engineering publication (similar to Toptal blog cards).',
    style === 'editorial-diagram'
      ? 'Editorial infographic style: crisp UI-card illustration, clean lines, modern iconography, subtle depth, not photorealistic.'
      : '3D isometric digital illustration: crisp edges, soft shadows, high clarity, not photorealistic.',
    topicLock,
    style === 'editorial-diagram'
      ? `Composition (follow closely): ${diagramLane}. Include one concise visual hierarchy with clear reading order.`
      : `Composition (follow closely for uniqueness): ${lane}.`,
    h2s.length
      ? `Use these section themes to keep visual relevance (do not render as text): ${h2s.join(' | ')}.`
      : '',
    `Color: cool blue palette with navy background and soft neutral panels; exactly one ${accent} accent for emphasis.`,
    'Lighting: clean, soft, studio-like. Avoid heavy glow, noise, and over-stylized effects.',
    'Layout: horizontal composition, structured blocks, generous whitespace, high legibility at card size.',
    'Render quality: ultra-clean edges, high micro-contrast, crisp silhouettes, no blur, no grain, no compression artifacts.',
    'No visible words, no letters, no numbers, no title text, no UI body copy, and no pseudo-typography anywhere in the image.',
    `Avoid overused clichés unless the topic clearly implies them: random floating cubes, generic "AI brain", stock lightbulb, handshake, puzzle pieces, or unrelated medical imagery.`,
    `If the topic suggests software delivery, testing, security, APIs, data, or agents, reflect that domain in the shapes and flow — still abstract, still one clear story.`,
    `Primary search phrase for tone only (never spell as readable text): ${k}. Title mood only (never as text): ${t}.`,
    'No logos, trademarks, brand marks, photorealistic people, noisy screenshots, watermarks, or any textual glyphs.'
  ].join(' ');
}

/** DALL·E 3: use landscape for blog cards; portrait sizes read "too tall" in grids. */
function resolveDalle3Size(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === '1024x1792') return { size: '1792x1024', note: 'portrait swapped to landscape for blog hero' };
  if (s === '1024x1024' || s === '1792x1024') return { size: s, note: null };
  return { size: '1792x1024', note: null };
}

function resolveImageSize(model, raw) {
  const m = String(model || '').toLowerCase();
  if (m === 'dall-e-3') {
    return resolveDalle3Size(raw).size;
  }
  if (isGptImageModel(model)) {
    const s = String(raw || '').trim().toLowerCase();
    const allowed = new Set(['auto', '1024x1024', '1536x1024', '1024x1536']);
    if (allowed.has(s)) return s;
    if (s === '1792x1024' || s === '1024x1792') return '1536x1024';
    return '1536x1024';
  }
  return String(raw || '1024x1024').trim() || '1024x1024';
}

function buildImageParams(model, prompt, size) {
  const m = String(model || '').toLowerCase();
  const params = {
    model,
    prompt,
    n: 1,
    size
  };
  if (isGptImageModel(model)) {
    params.output_format = String(process.env.OPENAI_IMAGE_OUTPUT_FORMAT || 'png').trim() || 'png';
    const q = imageQuality(model);
    if (q && ['low', 'medium', 'high', 'auto'].includes(String(q).toLowerCase())) {
      params.quality = String(q).toLowerCase();
    }
  } else {
    params.response_format = 'b64_json';
    const style = imageStyle(model);
    if (style) params.style = style;
    if (m === 'dall-e-3') {
      const q = String(imageQuality(model) || 'hd').toLowerCase();
      params.quality = q === 'standard' ? 'standard' : 'hd';
    } else if (m === 'dall-e-2') {
      params.quality = 'standard';
    }
  }
  return params;
}

async function generateImageWithFallback(client, params) {
  try {
    return await client.images.generate(params);
  } catch (err) {
    const model = String(params.model || '').toLowerCase();
    const retryable = model.startsWith('gpt-image') || model === 'dall-e-3';
    if (!retryable) throw err;
    const slim = { ...params };
    delete slim.quality;
    delete slim.style;
    delete slim.response_format;
    delete slim.output_format;
    if (model.startsWith('gpt-image')) {
      slim.size = '1536x1024';
      slim.output_format = 'png';
    }
    return client.images.generate(slim);
  }
}

async function writeImageFromApiItem(item, absPath) {
  const b64 = item && item.b64_json;
  if (b64) {
    fs.writeFileSync(absPath, Buffer.from(b64, 'base64'));
    return;
  }
  const url = item && item.url;
  if (url && /^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(absPath, buf);
    return;
  }
  throw new Error('Image API returned no b64_json or url (check model and billing)');
}

/**
 * Calls OpenAI Images API, writes PNG under runsDir, returns metadata for draft + UI.
 *
 * @param {string} apiKey
 * @param {{ runId: string, runsDir: string, title: string, keyword: string, metaDescription?: string, bodyExcerpt?: string }} opts
 */
async function generateHeroOnce(apiKey, opts, model) {
  const { runId, runsDir, title, keyword, metaDescription, bodyExcerpt } = opts;
  const client = new OpenAI({ apiKey });
  const prompt = buildHeroImagePrompt({
    title,
    keyword,
    metaDescription,
    bodyExcerpt
  });

  let size = String(
    process.env.OPENAI_IMAGE_SIZE || (String(model).toLowerCase() === 'dall-e-3' ? '1792x1024' : '1536x1024')
  );
  if (String(model).toLowerCase() === 'dall-e-3') {
    const resolved = resolveDalle3Size(size);
    if (resolved.note) console.warn(`[Image] ${resolved.note} (was ${process.env.OPENAI_IMAGE_SIZE})`);
  }
  size = resolveImageSize(model, size);
  const params = buildImageParams(model, prompt, size);
  const resp = await generateImageWithFallback(client, params);

  const item = resp.data && resp.data[0];
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const filename = `${runId}-hero.png`;
  const absPath = path.join(runsDir, filename);
  await writeImageFromApiItem(item, absPath);

  const relativePath = path.relative(process.cwd(), absPath).split(path.sep).join('/');

  return {
    filename,
    relativePath,
    absolutePath: absPath,
    prompt_used: prompt,
    revised_prompt: item.revised_prompt || null,
    model,
    size,
    mimeType: 'image/png'
  };
}

async function generateAndSaveBlogHeroImage(apiKey, opts) {
  const primary = imageModelName();
  const fallback = String(process.env.OPENAI_IMAGE_FALLBACK_MODEL || 'dall-e-3').trim();
  try {
    return await generateHeroOnce(apiKey, opts, primary);
  } catch (err) {
    if (fallback && fallback.toLowerCase() !== primary.toLowerCase()) {
      console.warn(`[Image] Hero with "${primary}" failed (${err.message}); retrying with "${fallback}".`);
      return generateHeroOnce(apiKey, opts, fallback);
    }
    throw err;
  }
}

function buildSectionImagePrompt({ keyword, sectionTitle, articleTitle, metaDescription }) {
  const k = clip(keyword, 120);
  const st = clip(cleanSectionTitle(sectionTitle), 120);
  const at = clip(articleTitle, 140);
  const md = clip(metaDescription, 220);
  return [
    'Create a clean 16:9 editorial diagram image for a technical blog section.',
    `Section concept (do not render text): ${st}.`,
    `Primary topic context (do not render text): ${k}.`,
    `Article context (do not render text): ${at}.`,
    md ? `Summary context (do not render text): ${md}.` : '',
    'Style: premium engineering publication visual, minimalist infographic, clean geometry, subtle depth.',
    'Composition: one clear concept per image; structured blocks/arrows/icons; high contrast and readability at card size.',
    'Color: deep blue background, cyan/blue primary elements, one soft accent color.',
    'Render quality: sharp and polished output, clean gradients, no blur, no fuzzy edges, no visual noise.',
    'No words, no letters, no numbers, no logos, no watermarks, no UI screenshots, no photorealistic humans.'
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateAndSaveSectionImages(apiKey, opts) {
  const { runId, runsDir, title, keyword, metaDescription, bodyMarkdown, maxImages = 2 } = opts;
  const model = imageModelName();
  const client = new OpenAI({ apiKey });
  const sectionTitles = extractH2Titles(bodyMarkdown)
    .filter((t) => !/^(sources|faq|decision checklist)$/i.test(String(t).trim()))
    .slice(0, Math.max(1, Number(maxImages) || 2));
  if (!sectionTitles.length) return [];

  const rawSize = String(
    process.env.OPENAI_IMAGE_SIZE || (String(model).toLowerCase() === 'dall-e-3' ? '1792x1024' : '1536x1024')
  );
  const size = resolveImageSize(model, rawSize);

  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const out = [];

  for (let i = 0; i < sectionTitles.length; i++) {
    const sectionTitle = sectionTitles[i];
    const prompt = buildSectionImagePrompt({
      keyword,
      sectionTitle,
      articleTitle: title,
      metaDescription
    });
    const params = buildImageParams(model, prompt, size);
    let resp;
    let usedModel = model;
    let usedSize = size;
    try {
      resp = await generateImageWithFallback(client, params);
    } catch (err) {
      const fb = String(process.env.OPENAI_IMAGE_FALLBACK_MODEL || 'dall-e-3').trim();
      if (fb && fb.toLowerCase() !== String(model).toLowerCase()) {
        usedModel = fb;
        usedSize = resolveImageSize(fb, rawSize);
        resp = await generateImageWithFallback(client, buildImageParams(fb, prompt, usedSize));
      } else {
        throw err;
      }
    }
    const item = resp.data && resp.data[0];
    const filename = `${runId}-section-${i + 1}.png`;
    const absPath = path.join(runsDir, filename);
    try {
      await writeImageFromApiItem(item, absPath);
    } catch (_) {
      continue;
    }
    const relativePath = path.relative(process.cwd(), absPath).split(path.sep).join('/');
    out.push({
      filename,
      relativePath,
      absolutePath: absPath,
      sectionTitle,
      prompt_used: prompt,
      revised_prompt: item.revised_prompt || null,
      model: usedModel,
      size: usedSize,
      mimeType: 'image/png'
    });
  }

  return out;
}

module.exports = {
  generateAndSaveBlogHeroImage,
  buildHeroImagePrompt,
  generateAndSaveSectionImages
};
