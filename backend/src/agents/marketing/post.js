// const axios = require('axios');

// function slugify(text) {
//   return (text || '')
//     .toString()
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '-')
//     .replace(/(^-|-$)+/g, '');
// }

// function estimateReadTime(words) {
//   const wpm = 200;
//   return Math.max(1, Math.round((words || 900) / wpm));
// }

// function formatParagraphs(text) {
//   if (!text) return [];
//   return text.split(/\n\n|\n/).map(p => p.trim()).filter(Boolean);
// }

// async function postBlog(blog, approvalResult) {
//   const POST_URL = process.env.POST_API_URL || 'http://192.168.100.77:5001/posts';
//   const POST_TOKEN = process.env.POST_API_KEY || 'key12345678901';

//   const now = new Date();
//   const publishedLabel = `Published ${now.toLocaleString('en-US', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`;

//   const payload = {
//     slug: slugify(blog.seo_title || blog.h1 || 'post'),
//     seo: {
//       title: blog.seo_title || blog.h1,
//       description: blog.meta_description || ''
//     },
//     hero: {
//       categoryLabel: process.env.HERO_CATEGORY || 'Insights',
//       title: blog.h1 || blog.seo_title,
//       subtitle: blog.meta_description || ''
//     },
//     author: {
//       avatarInitials: process.env.AUTHOR_INITIALS || 'AI',
//       name: process.env.AUTHOR_NAME || 'Automated Agent',
//       tagline: process.env.AUTHOR_TAGLINE || ''
//     },
//     articleMeta: {
//       readTimeLabel: `${estimateReadTime(blog.word_count)} min read`,
//       publishedLabel,
//       regionLabel: process.env.REGION_LABEL || 'Global'
//     },
//     trustLine: {
//       reviewerLabel: 'AI review',
//       lastUpdatedLabel: `Last updated ${now.toLocaleString('en-US', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`,
//       methodologyNote: process.env.METHODOLOGY_NOTE || ''
//     },
//     quickSummary: {
//       sectionLabel: 'Quick summary',
//       body: (blog.sections && blog.sections[0] && blog.sections[0].content) ? blog.sections[0].content.slice(0, 300) : (blog.conclusion || '')
//     },
//     toc: {
//       heading: 'Table of contents',
//       items: (blog.sections || []).map((s, i) => ({ id: (s.h2 || `section-${i}`).toLowerCase().replace(/[^a-z0-9]+/g,'-'), num: String(i+1).padStart(2,'0'), title: s.h2 }))
//     },
//     body: (function() {
//       const obj = {};
//       (blog.sections || []).forEach((s, i) => {
//         const key = (s.h2 || `section-${i}`).replace(/[^a-z0-9]/gi, '').replace(/\s+/g, '');
//         obj[key] = {
//           id: (s.h2 || `section-${i}`).toLowerCase().replace(/[^a-z0-9]+/g,'-'),
//           title: s.h2,
//           paragraphs: formatParagraphs(s.content)
//         };
//       });
//       return obj;
//     })(),
//     faq: blog.faq || null,
//     sources: blog.sources || null,
//     relatedReading: blog.relatedReading || null
//   };

//   const response = await axios.post(POST_URL, payload, {
//     headers: {
//       'Authorization': `Bearer ${POST_TOKEN}`,
//       'Content-Type': 'application/json'
//     }
//   });

//   return response.data;
// }

// module.exports = { postBlog };


const fs = require('fs');
const path = require('path');
const axios = require('axios');

function slugify(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function estimateReadTime(wordCount) {
  return Math.max(1, Math.round((wordCount || 900) / 200));
}

function slugFromTitle(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function markdownTableToBlock(block, idPrefix, idx) {
  const lines = String(block || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;
  if (!lines[0].startsWith('|') || !lines[1].startsWith('|')) return null;
  if (!/^\|?[\s:-|]+\|?$/.test(lines[1])) return null;
  const headers = lines[0]
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
  const rows = lines.slice(2).map((ln) =>
    ln
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean)
  );
  if (!headers.length || !rows.length) return null;
  return {
    id: `${idPrefix}-${idx}`,
    type: 'table',
    headers,
    rows
  };
}

function normalizeHeadingKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[`*_#]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function markdownToSectionBlocks(markdown, sectionImages = []) {
  const lines = String(markdown || '').split('\n');
  const sections = [];
  let paraBuf = [];
  let codeBuf = [];
  let inCode = false;
  let codeLang = '';
  let blockIdx = 1;
  const pendingByHeading = new Map();
  for (const img of Array.isArray(sectionImages) ? sectionImages : []) {
    const key = normalizeHeadingKey(img?.sectionTitle || img?.title || '');
    if (!key) continue;
    if (!pendingByHeading.has(key)) pendingByHeading.set(key, []);
    pendingByHeading.get(key).push(img);
  }

  const flushParagraph = () => {
    const text = paraBuf.join(' ').replace(/\s+/g, ' ').trim();
    paraBuf = [];
    if (!text) return;
    const tableBlock = markdownTableToBlock(text, 'table', blockIdx);
    if (tableBlock) {
      sections.push(tableBlock);
    } else {
      sections.push({ id: `p-${blockIdx}`, type: 'paragraph', text });
    }
    blockIdx += 1;
  };

  const flushCode = () => {
    if (!codeBuf.length) return;
    sections.push({
      id: `code-${blockIdx}`,
      type: 'code',
      language: codeLang || 'text',
      code: codeBuf.join('\n').trim()
    });
    blockIdx += 1;
    codeBuf = [];
    codeLang = '';
  };

  for (const raw of lines) {
    const line = raw || '';
    const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      if (!inCode) {
        flushParagraph();
        inCode = true;
        codeLang = fence[1] || 'text';
      } else {
        flushCode();
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)\s*$/);
    if (heading) {
      flushParagraph();
      const headingText = heading[2].trim();
      sections.push({
        id: `h${heading[1].length}-${blockIdx}`,
        type: 'heading',
        level: heading[1].length,
        text: headingText
      });
      blockIdx += 1;
      const headingKey = normalizeHeadingKey(headingText);
      const imgs = pendingByHeading.get(headingKey) || [];
      for (const img of imgs) {
        const src = img?.relativePath ? `/${String(img.relativePath).replace(/\\/g, '/')}` : '';
        if (!src) continue;
        sections.push({
          id: `img-${blockIdx}`,
          type: 'image',
          src,
          alt: `${headingText} visual`,
          caption: `Diagram for: ${headingText}`
        });
        blockIdx += 1;
      }
      pendingByHeading.delete(headingKey);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paraBuf.push(line.trim());
  }
  flushParagraph();
  if (inCode) flushCode();

  return sections;
}

function boolEnv(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return def;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

/** Backend Joi: relatedReading.items must have min 1 entry with title, description, href. */
function ensureRelatedReading(payload) {
  const base = String(process.env.SITE_BASE_URL || 'https://co-ventech.com').replace(/\/$/, '');
  const defaultHref = String(
    process.env.RELATED_READING_DEFAULT_HREF || `${base}/insights`
  );
  const rr = payload.relatedReading && typeof payload.relatedReading === 'object'
    ? payload.relatedReading
    : {};
  const raw = Array.isArray(rr.items) ? rr.items : [];
  const valid = raw.filter(
    (i) =>
      i &&
      typeof i === 'object' &&
      String(i.title || '').trim() &&
      String(i.description || '').trim() &&
      String(i.href || '').trim()
  );
  if (valid.length >= 1) {
    payload.relatedReading = {
      title: String(rr.title || 'Related reading').trim() || 'Related reading',
      intro: String(rr.intro || 'Short intro line.').trim() || 'Short intro line.',
      items: valid
    };
    return;
  }
  payload.relatedReading = {
    title: String(rr.title || 'Related reading').trim() || 'Related reading',
    intro: String(rr.intro || 'Go deeper on related topics.').trim() || 'Go deeper on related topics.',
    items: [
      {
        title: 'More from our blog',
        description: 'Practical guides on software delivery, QA automation, and DevOps.',
        href: defaultHref
      }
    ]
  };
}

function savePostPayloadSnapshot(payload) {
  const runsDir = path.join(process.cwd(), 'data', 'runs');
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  const filePath = path.join(runsDir, `${Date.now()}-post-payload.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

/** Resolve generated hero PNG on disk (server cannot use relativePath alone). */
function getHeroImageAbsolutePath(blog) {
  const hi = blog.hero_image;
  if (!hi || typeof hi !== 'object') return null;
  if (hi.absolutePath && fs.existsSync(hi.absolutePath)) return hi.absolutePath;
  const rel = hi.relativePath ? String(hi.relativePath).trim() : '';
  if (!rel) return null;
  const normalized = rel.split('/').join(path.sep);
  const resolved = path.isAbsolute(normalized) ? normalized : path.join(process.cwd(), normalized);
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * none — no image bytes (default).
 * meta — local paths only (only useful if your API stores metadata; still not a public URL).
 * base64 — embed PNG as base64 in JSON (large body; backend must accept and persist).
 * multipart — application: JSON field + file field (typical for real uploads).
 */
function postHeroImageDeliveryMode() {
  const d = String(process.env.POST_HERO_IMAGE_DELIVERY || '').trim().toLowerCase();
  if (['none', 'meta', 'base64', 'multipart'].includes(d)) return d;
  if (['1', 'true', 'yes'].includes(String(process.env.POST_INCLUDE_HERO_IMAGE_META || '').toLowerCase())) {
    return 'meta';
  }
  return 'none';
}

function attachHeroImageMeta(payload, blog) {
  if (
    !blog.hero_image ||
    typeof blog.hero_image !== 'object' ||
    !blog.hero_image.relativePath
  ) {
    return;
  }
  payload.heroImageMeta = {
    relativePath: blog.hero_image.relativePath,
    mimeType: blog.hero_image.mimeType || 'image/png',
    prompt: blog.hero_image.revised_prompt || blog.hero_image.prompt_used || ''
  };
}

function attachHeroImageBase64(payload, blog, absPath) {
  const buf = fs.readFileSync(absPath);
  const b64 = buf.toString('base64');
  const mime = blog.hero_image.mimeType || 'image/png';
  const filename = blog.hero_image.filename || 'hero.png';
  const parent = String(process.env.POST_HERO_IMAGE_BASE64_PARENT || 'root').trim().toLowerCase();
  if (parent === 'hero') {
    payload.hero = {
      ...payload.hero,
      imageBase64: b64,
      imageMimeType: mime,
      imageFilename: filename
    };
  } else {
    payload.heroImageBase64 = b64;
    payload.heroImageMimeType = mime;
    payload.heroImageFilename = filename;
  }
}

async function postBlogMultipart(POST_URL, POST_TOKEN, payload, imageAbsPath, blog) {
  const jsonField = String(process.env.POST_MULTIPART_JSON_FIELD || 'payload').trim() || 'payload';
  const fileField = String(process.env.POST_MULTIPART_FILE_FIELD || 'heroImage').trim() || 'heroImage';
  const filename = (blog.hero_image && blog.hero_image.filename) || 'hero.png';
  const mime = (blog.hero_image && blog.hero_image.mimeType) || 'image/png';

  const buf = fs.readFileSync(imageAbsPath);
  const form = new FormData();
  form.append(
    jsonField,
    new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    'blog.json'
  );
  form.append(fileField, new Blob([buf], { type: mime }), filename);

  const headers = {};
  if (POST_TOKEN) headers.Authorization = `Bearer ${POST_TOKEN}`;

  const timeoutMs = Number(process.env.POST_API_TIMEOUT_MS) || 30000;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(POST_URL, { method: 'POST', headers, body: form, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    /* keep raw string */
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data !== null && data.message ? data.message : text;
    throw new Error(`POST API rejected request (status ${res.status}): ${msg}`);
  }
  return data;
}

function getLocalImageAbsolutePath(src) {
  const s = String(src || '').trim();
  if (!s) return null;
  const normalized = s.replace(/\\/g, '/');
  if (/^https?:\/\//i.test(normalized)) return null;
  const noLead = normalized.replace(/^\/+/, '');
  const candidate = path.isAbsolute(noLead) ? noLead : path.join(process.cwd(), noLead);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveSectionImageUploadUrl(postsUrl) {
  const explicit = String(process.env.POST_SECTION_IMAGE_URL || '').trim();
  if (explicit) return explicit;
  return String(postsUrl || '').replace(/\/v1\/posts\/?$/i, '/v1/blog-media/sections');
}

async function uploadSectionImage(sectionImageUrl, token, imageAbsPath, fileName, sectionTitle) {
  const fileField = String(process.env.POST_SECTION_IMAGE_FILE_FIELD || 'image').trim() || 'image';
  const titleField = String(process.env.POST_SECTION_IMAGE_TITLE_FIELD || 'title').trim();
  const buf = fs.readFileSync(imageAbsPath);
  const form = new FormData();
  form.append(fileField, new Blob([buf], { type: 'image/png' }), fileName || 'section.png');
  if (titleField) form.append(titleField, String(sectionTitle || '').slice(0, 180));

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeoutMs = Number(process.env.POST_API_TIMEOUT_MS) || 30000;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(sectionImageUrl, { method: 'POST', headers, body: form, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    /* keep raw */
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data !== null && data.message ? data.message : text;
    throw new Error(`Section image upload failed (status ${res.status}): ${msg}`);
  }
  if (typeof data === 'string') return data;
  return data.url || data.imageUrl || data.src || data.path || '';
}

async function uploadSectionImagesIfNeeded(payload, postUrl, token) {
  if (!Array.isArray(payload.sections) || !payload.sections.length) return;
  const sectionImageUrl = resolveSectionImageUploadUrl(postUrl);
  if (!sectionImageUrl || !/^https?:\/\//i.test(sectionImageUrl)) return;
  const imageBlocks = payload.sections.filter((b) => b && b.type === 'image' && b.src);
  if (!imageBlocks.length) {
    console.log('[POST] Section image upload skipped: no image blocks in sections[]');
    return;
  }
  console.log(`[POST] Section image upload target: ${sectionImageUrl}`);
  let uploadedCount = 0;
  for (const block of payload.sections) {
    if (!block || block.type !== 'image' || !block.src) continue;
    const localAbs = getLocalImageAbsolutePath(block.src);
    if (!localAbs) continue;
    const uploadedUrl = await uploadSectionImage(
      sectionImageUrl,
      token,
      localAbs,
      path.basename(localAbs),
      block.caption || block.alt || ''
    );
    if (!uploadedUrl) {
      throw new Error(`Section image upload returned empty URL for ${block.id || 'unknown block'}`);
    }
    block.src = uploadedUrl;
    uploadedCount += 1;
    console.log(`[POST] Section image uploaded (${uploadedCount}/${imageBlocks.length}) -> ${uploadedUrl}`);
  }
  if (!uploadedCount) {
    console.log('[POST] Section image upload skipped: no local section image files found.');
  }
}

async function postBlog(blog, approvalResult) {
  const POST_URL = String(process.env.POST_API_URL || '').trim();
  const POST_TOKEN = String(process.env.POST_API_KEY || '').trim();

  const now = new Date();
  const dateLabel = now.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // sections is now an object with fixed keys — not an array
  const s = blog.sections || {};
  const tocItems = Array.isArray(blog.toc_items) ? blog.toc_items : [];
  const quickSummaryText = String(blog.quick_summary || '').trim();
  const metaTitle = blog.meta_title || blog.seo_title || blog.h1;
  const includeRelatedReading = boolEnv('POST_INCLUDE_RELATED_READING', true);
  const includeQuickSummary = boolEnv('POST_INCLUDE_QUICK_SUMMARY', false);
  const includeToc = boolEnv('POST_INCLUDE_TOC', false);
  const includeLegacyBody = boolEnv('POST_INCLUDE_LEGACY_BODY', false);
  const includeCardFields = boolEnv('POST_INCLUDE_CARD_FIELDS', false);
  const readMins = estimateReadTime(blog.word_count);
  const cardTag = String(blog.topic_tag || process.env.DEFAULT_BLOG_TAG || 'BLOG').trim();
  const cardDescription = String(blog.card_description || blog.meta_description || '').trim();
  const localHeroUrl = blog.hero_image?.relativePath
    ? `/${String(blog.hero_image.relativePath).replace(/\\/g, '/')}`
    : '';
  const sectionBlocks = markdownToSectionBlocks(blog.body_markdown, blog.section_images);

  const payload = {
    slug: slugify(blog.seo_title || blog.h1 || 'post'),

    seo: {
      title: metaTitle,
      description: blog.meta_description || ''
    },

    hero: {
      categoryLabel: cardTag || process.env.HERO_CATEGORY || 'Engineering insights',
      title: blog.h1 || blog.seo_title,
      subtitle: blog.meta_description || '',
      coverImageUrl: localHeroUrl || undefined
    },

    author: {
      avatarInitials: process.env.AUTHOR_INITIALS || 'CV',
      name: process.env.AUTHOR_NAME || 'Co-Ventech Editorial',
      // never send empty string — backend rejects it
      tagline: blog.author_tagline || process.env.AUTHOR_TAGLINE || 'Software delivery · Remote-first'
    },

    articleMeta: {
      readTimeLabel: `${estimateReadTime(blog.word_count)} min read`,
      publishedLabel: `Published ${dateLabel}`,
      regionLabel: process.env.REGION_LABEL || 'Global'
    },

    trustLine: {
      reviewerLabel: 'Reviewed by a Delivery Lead',
      lastUpdatedLabel: `Last updated ${dateLabel}`,
      // never send empty string — backend rejects it
      methodologyNote: blog.methodology_note || process.env.METHODOLOGY_NOTE || 'Based on DORA metrics and industry best practices'
    },
    sections: sectionBlocks,

    faq: blog.faq && typeof blog.faq === 'object' ? blog.faq : {
      title: 'Frequently asked questions',
      subtitle: 'Common questions answered.',
      items: []
    },

    sources: blog.sources && typeof blog.sources === 'object' ? blog.sources : {
      heading: 'Sources and further reading',
      items: []
    },

    relatedReading: includeRelatedReading
      ? blog.relatedReading && typeof blog.relatedReading === 'object'
        ? blog.relatedReading
        : {
            title: 'Related reading',
            intro: 'Go deeper on related topics.',
            items: []
          }
      : undefined
  };

  if (includeCardFields) {
    payload.tag = cardTag;
    payload.readTime = `${readMins} MIN READ`;
    payload.description = cardDescription;
    payload.topic = String(blog.target_keyword || '').trim();
  }

  if (includeLegacyBody) {
    payload.body = {
      whatMeans: {
        id: 'what-means',
        title: s.whatMeans?.title || 'Introduction',
        paragraphs: s.whatMeans?.paragraphs || []
      },
      comparingModels: {
        id: 'comparing-models',
        title: s.comparingModels?.title || 'Comparing models',
        intro: s.comparingModels?.intro || '',
        tableHeaders: s.comparingModels?.tableHeaders || ['Model', 'Who drives it', 'Primary use case'],
        rows: s.comparingModels?.rows || []
      },
      operatingRhythm: {
        id: 'operating-rhythm',
        keyFactSectionLabel: 'Key fact',
        keyFactTitle: s.operatingRhythm?.keyFactTitle || 'Key fact',
        keyFactBody: s.operatingRhythm?.keyFactBody || '',
        subheading: s.operatingRhythm?.subheading || '',
        paragraphs: s.operatingRhythm?.paragraphs || []
      },
      qualityAtScale: {
        id: 'quality-at-scale',
        title: s.qualityAtScale?.title || 'Quality at scale',
        paragraphs: s.qualityAtScale?.paragraphs || []
      },
      devopsCulture: {
        id: 'devops-culture',
        title: s.devopsCulture?.title || 'DevOps culture',
        paragraphs: s.devopsCulture?.paragraphs || []
      },
      securityByDesign: {
        id: 'security-by-design',
        title: s.securityByDesign?.title || 'Security by design',
        paragraphs: s.securityByDesign?.paragraphs || []
      },
      choosingPartners: {
        id: 'choosing-partners',
        title: s.choosingPartners?.title || 'Choosing partners',
        paragraphs: s.choosingPartners?.paragraphs || []
      },
      nextSteps: {
        id: 'next-steps',
        title: s.nextSteps?.title || 'Next steps',
        paragraphs: s.nextSteps?.paragraphs || [],
        ctaLeadIn: s.nextSteps?.ctaLeadIn || 'Want to go deeper? ',
        ctaLinkLabel: s.nextSteps?.ctaLinkLabel || 'Talk to us',
        ctaHref: s.nextSteps?.ctaHref || '/contact'
      },
      pullQuote: {
        id: 'pull-quote',
        quote: blog.pull_quote || '',
        attribution: process.env.AUTHOR_NAME || 'Co-Ventech Editorial Team'
      }
    };
  }

  if (includeQuickSummary) {
    payload.quickSummary = {
      sectionLabel: 'Quick summary',
      body:
        quickSummaryText.slice(0, 300) ||
        s.whatMeans?.paragraphs?.[0]?.slice(0, 300) ||
        blog.meta_description ||
        ''
    };
  }

  if (includeToc) {
    payload.toc = {
      heading: 'Table of contents',
      items:
        tocItems.length > 0
          ? tocItems.slice(0, 12).map((x, i) => ({
              id: String(x.id || slugFromTitle(x.title || `section-${i + 1}`)),
              num: String(x.num || String(i + 1).padStart(2, '0')),
              title: String(x.title || `Section ${i + 1}`)
            }))
          : [
              { id: 'what-means',         num: '01', title: s.whatMeans?.title || 'Introduction' },
              { id: 'comparing-models',   num: '02', title: s.comparingModels?.title || 'Comparing models' },
              { id: 'operating-rhythm',   num: '03', title: s.operatingRhythm?.subheading || 'Operating rhythm' },
              { id: 'quality-at-scale',   num: '04', title: s.qualityAtScale?.title || 'Quality at scale' },
              { id: 'devops-culture',     num: '05', title: s.devopsCulture?.title || 'DevOps culture' },
              { id: 'security-by-design', num: '06', title: s.securityByDesign?.title || 'Security by design' },
              { id: 'choosing-partners',  num: '07', title: s.choosingPartners?.title || 'Choosing partners' },
              { id: 'next-steps',         num: '08', title: s.nextSteps?.title || 'Next steps' },
              { id: 'faq',                num: '09', title: 'Frequently asked questions' },
              { id: 'sources',            num: '10', title: 'Sources and further reading' }
            ]
    };
  }

  // Hero image: JSON alone cannot display a file — the server needs bytes (base64/multipart) or a public URL you host.
  const heroDelivery = postHeroImageDeliveryMode();
  const heroAbs = getHeroImageAbsolutePath(blog);

  if (heroDelivery === 'meta') {
    if (blog.hero_image && typeof blog.hero_image === 'object' && blog.hero_image.relativePath) {
      attachHeroImageMeta(payload, blog);
    }
  } else if (heroDelivery === 'base64') {
    if (heroAbs) {
      attachHeroImageBase64(payload, blog, heroAbs);
    } else {
      console.warn('[POST] POST_HERO_IMAGE_DELIVERY=base64 but hero PNG not found on disk — skipping image.');
    }
  } else if (heroDelivery === 'multipart' && !heroAbs) {
    console.warn('[POST] POST_HERO_IMAGE_DELIVERY=multipart but hero PNG not found — sending JSON only.');
  }

  if (includeRelatedReading) {
    ensureRelatedReading(payload);
  } else {
    delete payload.relatedReading;
  }

  if (!POST_URL) {
    const snapshotPath = savePostPayloadSnapshot(payload);
    return {
      dryRun: true,
      reason: 'POST_API_URL not set',
      snapshotPath,
      slug: payload.slug
    };
  }
  if (!/^https?:\/\//i.test(POST_URL)) {
    throw new Error(`POST_API_URL must start with http:// or https://. Received: "${POST_URL}"`);
  }

  await uploadSectionImagesIfNeeded(payload, POST_URL, POST_TOKEN);

  if (heroDelivery === 'multipart' && heroAbs) {
    try {
      console.log(`\n[POST] Sending multipart (JSON + hero image) to: ${POST_URL}`);
      const data = await postBlogMultipart(POST_URL, POST_TOKEN, payload, heroAbs, blog);
      console.log('[POST] Success — multipart upload completed.');
      return data;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (POST_TOKEN) headers.Authorization = `Bearer ${POST_TOKEN}`;

  try {
    console.log(`\n[POST] Sending blog JSON to: ${POST_URL}`);
    const response = await axios.post(POST_URL, payload, {
      headers,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: Number(process.env.POST_API_TIMEOUT_MS) || 30000
    });
    console.log(
      `[POST] Success — HTTP ${response.status}. Your API responded (e.g. slug + message).`
    );
    return response.data;
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const msg = err.response.data?.message || JSON.stringify(err.response.data);
      throw new Error(`POST API rejected request (status ${status}): ${msg}`);
    }
    throw new Error(`POST API request failed: ${err.message}`);
  }
}

module.exports = { postBlog, slugify };