/**
 * Maps flat JSON draft (title, body_markdown, faq[]) into the legacy blog shape
 * expected by approve.js / post.js (sections object + faq.items).
 */

function relatedReadingHref() {
  const base = String(process.env.SITE_BASE_URL || 'https://co-ventech.com').replace(/\/$/, '');
  return String(process.env.RELATED_READING_DEFAULT_HREF || `${base}/insights`);
}

function buildRelatedReadingItems(draft) {
  const href = relatedReadingHref();
  const sec = (draft.secondary_keywords || []).filter(Boolean).slice(0, 5);
  if (sec.length) {
    return sec.map((t) => ({
      title: String(t),
      description: 'Related angle from SERP research; worth a dedicated follow-up read.',
      href
    }));
  }
  return [
    {
      title: 'More engineering guides',
      description: 'Practical articles on QA, DevOps, AI-assisted delivery, and secure software shipping.',
      href
    }
  ];
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function topicTagFromKeyword(keyword) {
  const k = String(keyword || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!k) return 'BLOG';
  const label = k.length > 36 ? `${k.slice(0, 36).trim()}...` : k;
  return `BLOG · ${label.toUpperCase()}`;
}

function parseMarkdownSections(md) {
  const lines = String(md || '').split('\n');
  const introLines = [];
  const sections = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const paragraphs = current.buffer
      .join('\n')
      .split(/\n{2,}/)
      .map((x) => x.trim())
      .filter(Boolean);
    current.paragraphs = paragraphs;
    delete current.buffer;
    sections.push(current);
  };

  for (const raw of lines) {
    const line = raw || '';
    const h2 = line.match(/^##\s+(.+)\s*$/);
    const h3 = line.match(/^###\s+(.+)\s*$/);
    if (h2) {
      flush();
      const title = h2[1].trim();
      current = {
        level: 2,
        title,
        subheadings: [],
        buffer: []
      };
      continue;
    }
    if (h3 && current) {
      current.subheadings.push(h3[1].trim());
      current.buffer.push(line);
      continue;
    }
    if (!current) {
      introLines.push(line);
    } else {
      current.buffer.push(line);
    }
  }
  flush();

  const intro = introLines
    .join('\n')
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);

  return { intro, sections };
}

function pickSectionByKeyword(parsedSections, patterns, fallbackIndex = 0) {
  const idx = parsedSections.findIndex((s) => {
    const t = String(s.title || '').toLowerCase();
    return patterns.some((p) => t.includes(p));
  });
  if (idx >= 0) return parsedSections[idx];
  return parsedSections[fallbackIndex] || null;
}

function extractSourcesFromMarkdown(md) {
  const srcMatch = String(md || '').match(/##\s+Sources[\s\S]*$/i);
  if (!srcMatch) return [];
  const block = srcMatch[0];
  const links = [...block.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)];
  return links.slice(0, 8).map((m) => ({
    title: m[1].trim(),
    description: m[2].trim()
  }));
}

/** FAQ is delivered as JSON `faq` for the API — remove duplicate H2 FAQ blocks from markdown. */
function stripFaqSectionsFromMarkdown(md) {
  let s = String(md || '');
  s = s.replace(/\n##\s+FAQ\s*\n[\s\S]*?(?=\n##\s+|$)/i, '\n');
  s = s.replace(/\n##\s+Frequently asked questions\s*\n[\s\S]*?(?=\n##\s+|$)/i, '\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/** Task list `- [ ]` renders as literal brackets if the UI is not GFM-aware; use plain bullets. */
function normalizeMarkdownTaskBullets(md) {
  return String(md || '').replace(/^(\s*-\s*)\[[ xX]\]\s+/gm, '$1');
}

function adaptDraftForApproval(draft) {
  const md = normalizeMarkdownTaskBullets(stripFaqSectionsFromMarkdown(String(draft.body_markdown || '')));
  const parsed = parseMarkdownSections(md);
  const parsedSections = parsed.sections;
  const intro = parsed.intro;
  const fallbackTitle = String(draft.target_keyword || draft.h1 || draft.title || 'the topic');
  const fallbackIntro = intro.length ? intro : ['(expand body in CMS)'];

  function parseFirstMarkdownTable(md) {
    const lines = String(md || '')
      .split('\n')
      .map((l) => l.trim());
    for (let i = 0; i < lines.length - 2; i++) {
      if (!lines[i].startsWith('|') || !lines[i + 1].startsWith('|')) continue;
      if (!/^\|?[\s:-|]+\|?$/.test(lines[i + 1])) continue;
      const header = lines[i]
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean);
      const rows = [];
      for (let j = i + 2; j < lines.length; j++) {
        if (!lines[j].startsWith('|')) break;
        const cols = lines[j]
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean);
        if (cols.length >= 2) rows.push(cols);
      }
      if (!header.length || !rows.length) continue;
      return {
        header,
        rows
      };
    }
    return null;
  }

  const mdTable = parseFirstMarkdownTable(draft.body_markdown);
  const dynamicRows = mdTable
    ? mdTable.rows.slice(0, 4).map((cols) => ({
        model: cols[0] || 'Approach',
        who: cols[1] || 'Context',
        useCase: cols[2] || cols[1] || 'Use case'
      }))
    : [
        {
          model: `Baseline approach for ${fallbackTitle}`,
          who: 'Small product teams',
          useCase: 'Fast validation with minimal change'
        },
        {
          model: `Scaled implementation for ${fallbackTitle}`,
          who: 'Platform and DevOps teams',
          useCase: 'Consistent operations across services'
        },
        {
          model: `Risk-managed rollout for ${fallbackTitle}`,
          who: 'Engineering managers',
          useCase: 'Safer migration and stakeholder alignment'
        }
      ];

  const sWhat = pickSectionByKeyword(parsedSections, ['what', 'understanding', 'overview', 'architecture'], 0);
  const sTradeoffs = pickSectionByKeyword(parsedSections, ['tradeoff', 'comparison', 'vs', 'table'], 1);
  const sImpl = pickSectionByKeyword(parsedSections, ['implement', 'walkthrough', 'setup', 'guide'], 2);
  const sPitfalls = pickSectionByKeyword(parsedSections, ['pitfall', 'anti-pattern', 'mistake'], 3);
  const sChecklist = pickSectionByKeyword(parsedSections, ['decision checklist', 'checklist', 'next step'], 4);

  const tocItems = parsedSections.slice(0, 12).map((s, i) => ({
    id: slugify(s.title || `section-${i + 1}`),
    num: String(i + 1).padStart(2, '0'),
    title: s.title || `Section ${i + 1}`
  }));

  const parsedSources = extractSourcesFromMarkdown(md);

  const faqItems = Array.isArray(draft.faq)
    ? draft.faq.map((x) => ({
        question: x.question || x.q || '',
        answer: x.answer || x.a || ''
      }))
    : [];

  return {
    meta_title: draft.title || draft.seo_title || '',
    seo_title: draft.title || draft.seo_title || '',
    meta_description: draft.meta_description || '',
    h1: draft.h1 || draft.title || '',
    body_markdown: md,
    word_count: draft._word_estimate || 0,
    pull_quote: (fallbackIntro[0] || '').replace(/^#+\s*/, '').slice(0, 240),
    author_tagline: 'Engineering · DevOps · QA · Security',
    // methodology_note: 'Grounded in live Google Trends + SERP signals from the same run.',
    quick_summary: fallbackIntro[0] || draft.meta_description || '',
    toc_items: tocItems,
    topic_tag: topicTagFromKeyword(draft.target_keyword || draft.title || ''),
    card_description:
      fallbackIntro.join(' ').slice(0, 220) ||
      String(draft.meta_description || '').slice(0, 220),
    article_sections: parsedSections.map((s, i) => ({
      id: slugify(s.title || `section-${i + 1}`),
      title: s.title || `Section ${i + 1}`,
      subheadings: s.subheadings || [],
      paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs : []
    })),
    sections: {
      whatMeans: {
        title: sWhat?.title || 'What this means in practice',
        paragraphs: sWhat?.paragraphs?.length ? sWhat.paragraphs.slice(0, 3) : fallbackIntro.slice(0, 2)
      },
      comparingModels: {
        title: sTradeoffs?.title || (mdTable?.header?.[0] ? `${mdTable.header[0]} tradeoffs` : 'Tradeoffs teams actually hit'),
        intro: (sTradeoffs?.paragraphs && sTradeoffs.paragraphs[0]) || 'Different stacks imply different failure modes.',
        tableHeaders: ['Approach', 'Best when', 'Watch out for'],
        rows: dynamicRows
      },
      operatingRhythm: {
        keyFactTitle: 'Signal from search demand',
        keyFactBody: `Primary keyword: ${draft.target_keyword || ''}.`,
        subheading: sImpl?.title || 'How this shows up in delivery work',
        paragraphs: sImpl?.paragraphs?.length ? sImpl.paragraphs.slice(0, 3) : fallbackIntro.slice(0, 2)
      },
      qualityAtScale: {
        title: sPitfalls?.title || 'Implementation notes',
        paragraphs: sPitfalls?.paragraphs?.length ? sPitfalls.paragraphs.slice(0, 3) : fallbackIntro.slice(0, 2)
      },
      devopsCulture: {
        title: parsedSections[4]?.title || 'Ownership and feedback loops',
        paragraphs: parsedSections[4]?.paragraphs?.slice(0, 3) || fallbackIntro.slice(0, 2)
      },
      securityByDesign: {
        title: parsedSections[5]?.title || 'Safety and defaults',
        paragraphs: parsedSections[5]?.paragraphs?.slice(0, 3) || fallbackIntro.slice(0, 2)
      },
      choosingPartners: {
        title: parsedSections[6]?.title || 'Choosing the next step',
        paragraphs: parsedSections[6]?.paragraphs?.slice(0, 3) || fallbackIntro.slice(0, 2)
      },
      nextSteps: {
        title: sChecklist?.title || 'Practical next steps',
        paragraphs: sChecklist?.paragraphs?.length ? sChecklist.paragraphs.slice(0, 3) : fallbackIntro.slice(0, 2),
        ctaLeadIn: 'Want a second pair of eyes on your pipeline or test strategy? ',
        ctaLinkLabel: 'Talk to Co-Ventech',
        ctaHref: '/contact'
      }
    },
    faq: {
      title: 'Frequently asked questions',
      subtitle: 'Straight answers for busy engineers.',
      items: faqItems.length
        ? faqItems
        : [
            { question: 'Where should we start?', answer: 'Instrument one critical path first.' },
            { question: 'What is the biggest mistake?', answer: 'Optimizing metrics nobody ships against.' }
          ]
    },
    sources: {
      heading: 'Further reading',
      items: parsedSources.length
        ? parsedSources
        : (draft.secondary_keywords || []).slice(0, 4).map((t) => ({
            title: String(t),
            description: 'Related angle worth exploring.'
          }))
    },
    relatedReading: {
      title: 'Related reading',
      intro: 'Deep dives that pair well with this topic.',
      items: buildRelatedReadingItems(draft)
    },
    hero_image: draft.hero_image && typeof draft.hero_image === 'object' ? draft.hero_image : null,
    section_images: Array.isArray(draft.section_images) ? draft.section_images : []
  };
}

module.exports = { adaptDraftForApproval };
