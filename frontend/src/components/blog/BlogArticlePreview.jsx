import React, { useMemo } from 'react'
import { blogAssetUrl, blogHeroUrl, blogSectionImageUrl } from '../../utils/blogPreviewAssets'
import { markdownToPreviewBlocks } from '../../utils/markdownToPreviewBlocks'
import RichText from './RichText'
import MermaidDiagram from './MermaidDiagram'

const styles = {
  page: {
    minHeight: '100%',
    background: '#fff',
    color: '#0f172a',
    fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  },
  progressTrack: {
    height: '3px',
    background: '#e5e7eb',
    width: '100%'
  },
  progressFill: {
    height: '100%',
    width: '0%',
    background: '#2563eb',
    transition: 'width 0.15s ease-out'
  },
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    borderBottom: '1px solid #f1f5f9'
  },
  heroText: {
    padding: '24px 20px 32px',
    maxWidth: '720px'
  },
  heroImageWrap: {
    minHeight: '240px',
    background: '#f3f4f6',
    position: 'relative'
  },
  heroImage: {
    width: '100%',
    height: '100%',
    minHeight: '240px',
    objectFit: 'cover',
    display: 'block'
  },
  figureCenter: {
    margin: '28px auto',
    maxWidth: '680px',
    textAlign: 'center'
  },
  articleImage: {
    display: 'block',
    width: '100%',
    maxWidth: '680px',
    maxHeight: '380px',
    height: 'auto',
    objectFit: 'contain',
    margin: '0 auto',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
  },
  articleWrap: {
    maxWidth: 'min(74rem, 100%)',
    margin: '0 auto',
    padding: '32px 20px 48px'
  },
  h2: {
    margin: '40px 0 12px',
    fontSize: '1.35rem',
    fontWeight: 700,
    lineHeight: 1.3,
    color: '#1e3a8a'
  },
  h3: {
    margin: '24px 0 8px',
    fontSize: '1.05rem',
    fontWeight: 700,
    color: '#0f172a'
  },
  paragraph: {
    margin: '0 0 20px',
    fontSize: '1.05rem',
    lineHeight: 1.82,
    color: '#334155',
    textAlign: 'justify'
  },
  tableWrap: {
    margin: '28px auto',
    maxWidth: '100%',
    overflowX: 'auto',
    border: '1px solid #9ec2da',
    borderRadius: '8px',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)'
  },
  table: {
    width: '100%',
    minWidth: '480px',
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontSize: '0.97rem',
    fontFamily: 'inherit'
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontWeight: 600,
    background: '#f4f8fb',
    borderBottom: '1px solid #9ec2da',
    color: '#1f2937',
    verticalAlign: 'top',
    lineHeight: 1.5
  },
  td: {
    padding: '12px 16px',
    borderBottom: '1px solid #c6dceb',
    color: '#334155',
    verticalAlign: 'top',
    lineHeight: 1.55
  },
  faqSection: {
    marginTop: '48px',
    paddingTop: '32px',
    borderTop: '1px solid #e5e7eb'
  }
}

function estimateReadTime(markdown) {
  const words = String(markdown || '').split(/\s+/).filter(Boolean).length
  const mins = Math.max(1, Math.round(words / 200))
  return `${mins} MIN READ`
}

function BlockRenderer({ block, run, sectionImageIndex, sectionImages }) {
  if (block.type === 'heading') {
    return <h2 style={styles.h2}>{block.text}</h2>
  }
  if (block.type === 'subheading') {
    return <h3 style={styles.h3}>{block.text}</h3>
  }
  if (block.type === 'paragraph') {
    return (
      <p style={styles.paragraph}>
        <RichText text={block.text} />
      </p>
    )
  }
  if (block.type === 'bulletList') {
    return (
      <ul
        style={{
          margin: '0 0 20px',
          paddingLeft: '1.35rem',
          listStyleType: 'disc',
          listStylePosition: 'outside'
        }}
      >
        {block.items.map((item, idx) => (
          <li
            key={idx}
            style={{
              marginBottom: '10px',
              fontSize: '1.05rem',
              lineHeight: 1.78,
              color: '#334155',
              paddingLeft: '4px'
            }}
          >
            <RichText text={item} />
          </li>
        ))}
      </ul>
    )
  }
  if (block.type === 'table') {
    return (
      <div style={styles.tableWrap} role="region" aria-label="Comparison table">
        <table style={styles.table}>
          <thead>
            <tr>
              {block.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    ...styles.th,
                    borderLeft: i ? '1px solid #9ec2da' : undefined,
                    width: i === 0 ? '22%' : undefined
                  }}
                >
                  <RichText text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 ? '#f9fcff' : '#fff' }}>
                {block.headers.map((_, ci) => (
                  <td
                    key={ci}
                    style={{
                      ...styles.td,
                      borderLeft: ci ? '1px solid #c6dceb' : undefined,
                      fontWeight: ci === 0 ? 600 : 400,
                      color: ci === 0 ? '#1f2937' : '#334155'
                    }}
                  >
                    <RichText text={row[ci] ?? ''} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (block.type === 'image') {
    const imgMeta = sectionImages?.[sectionImageIndex]
    const src =
      blogAssetUrl(block.src) ||
      blogSectionImageUrl(imgMeta, run, sectionImageIndex) ||
      (run?._id
        ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/blog-pipeline/runs/${run._id}/images/section-${(sectionImageIndex ?? 0) + 1}`
        : '')
    if (!src) return null
    return (
      <figure style={styles.figureCenter}>
        <img src={src} alt={block.alt || ''} style={styles.articleImage} loading="lazy" />
      </figure>
    )
  }
  if (block.type === 'code') {
    const lang = (block.language || '').toLowerCase()
    if (lang === 'mermaid') {
      return <MermaidDiagram code={block.code} />
    }
    return (
      <div style={{ margin: '24px 0', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        {block.language && block.language !== 'text' ? (
          <div style={{ padding: '8px 12px', background: '#f3f4f6', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>
            {block.language}
          </div>
        ) : null}
        <pre style={{ margin: 0, padding: '12px', fontSize: '13px', overflow: 'auto', background: '#f9fafb' }}>
          <code>{block.code}</code>
        </pre>
      </div>
    )
  }
  return null
}

/**
 * Article-only preview (Co-Ventech blog layout, no sidebars / share / newsletter).
 */
export default function BlogArticlePreview({ run }) {
  const draft = run?.draft || {}
  const title = draft.h1 || draft.seoTitle || run?.topic?.phrase || 'Blog preview'
  const description = draft.metaDescription || ''
  const heroSrc =
    blogHeroUrl(run) ||
    (run?._id
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/blog-pipeline/runs/${run._id}/images/hero`
      : '')
  const bodyMarkdown = draft.bodyMarkdown || ''
  const sectionImages = draft.sectionImages || []

  const blocks = useMemo(() => {
    const parsed = markdownToPreviewBlocks(bodyMarkdown, sectionImages)
    let sectionIdx = 0
    return parsed.map((block) => {
      if (block.type !== 'image') return block
      const withIdx = { ...block, _sectionIdx: sectionIdx }
      sectionIdx += 1
      return withIdx
    })
  }, [bodyMarkdown, sectionImages])

  const readTime = estimateReadTime(bodyMarkdown)
  const category = (run?.topic?.intent || 'BLOG').replace(/_/g, ' ')

  const faq = Array.isArray(draft.faq) ? draft.faq : []

  return (
    <div style={styles.page}>
      <div style={styles.progressTrack} aria-hidden>
        <div style={styles.progressFill} />
      </div>

      <style>{`
        .blog-preview-hero-grid { display: grid; grid-template-columns: 1fr 1fr; }
        @media (max-width: 768px) {
          .blog-preview-hero-grid { grid-template-columns: 1fr; }
        }
      `}</style>
      <section style={styles.heroGrid}>
        <div className={heroSrc ? 'blog-preview-hero-grid' : ''} style={!heroSrc ? { display: 'block' } : undefined}>
          <div style={styles.heroText}>
            <div style={{ width: '48px', height: '4px', background: '#2563eb', marginBottom: '24px' }} aria-hidden />
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', color: '#2563eb', textTransform: 'uppercase' }}>
              {category}
              <span style={{ color: '#0f172a', marginLeft: '12px' }}>{readTime}</span>
            </div>
            <h1 style={{ margin: '16px 0 0', fontSize: 'clamp(1.75rem, 4vw, 2.35rem)', fontWeight: 700, lineHeight: 1.15, color: '#000', maxWidth: '36rem' }}>
              {title}
            </h1>
            {description ? (
              <p style={{ margin: '20px 0 0', fontSize: '1.05rem', lineHeight: 1.6, color: '#525252', maxWidth: '36rem' }}>
                {description}
              </p>
            ) : null}
            {draft.methodologyNote ? (
              <p style={{ margin: '24px 0 0', fontSize: '0.8rem', lineHeight: 1.6, color: '#737373', maxWidth: '36rem' }}>
                {draft.methodologyNote}
              </p>
            ) : null}
          </div>
          {heroSrc ? (
            <div style={styles.heroImageWrap}>
              <img src={heroSrc} alt="" style={styles.heroImage} />
            </div>
          ) : null}
        </div>
      </section>

      <div style={styles.articleWrap}>
        <article>
          {blocks.map((block) => (
            <BlockRenderer
              key={block.id}
              block={block}
              run={run}
              sectionImages={sectionImages}
              sectionImageIndex={block._sectionIdx}
            />
          ))}
        </article>

        {faq.length > 0 ? (
          <section style={styles.faqSection} aria-labelledby="preview-faq-heading">
            <h2 id="preview-faq-heading" style={{ ...styles.h2, marginTop: 0 }}>
              FAQ
            </h2>
            {faq.map((item, i) => (
              <div key={i} style={{ marginBottom: '20px' }}>
                <h3 style={{ ...styles.h3, marginTop: 0 }}>{item.question}</h3>
                <p style={{ ...styles.paragraph, marginBottom: 0 }}>{item.answer}</p>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  )
}
