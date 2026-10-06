import React, { useEffect, useMemo, useState } from 'react'
import {
  cleanupMermaidDom,
  loadMermaid,
  normalizeMermaidSource,
  stripMermaidFences
} from '../../utils/loadMermaid'

const FONT =
  'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'

/** Co-Ventech blog palette — matches live site pie charts */
const PIE_SLICE_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#ef4444',
  '#ec4899',
  '#14b8a6'
]

function isFlowchart(code) {
  return /^\s*(flowchart|graph)\b/im.test(code)
}

function isPieChart(code) {
  return /^\s*pie\b/im.test(code)
}

function isVividColor(color) {
  const hex = String(color || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return Math.max(r, g, b) - Math.min(r, g, b) > 28
}

function extractLegendColors(svg) {
  const legendBlock = svg.match(/<g[^>]*class="[^"]*legend[^"]*"[^>]*>[\s\S]*?<\/g>/i)
  if (!legendBlock) return []
  const fills = []
  const re = /<rect[^>]*\bfill="([^"]+)"/gi
  let m
  while ((m = re.exec(legendBlock[0]))) {
    const c = m[1].trim()
    if (c && c !== 'none' && isVividColor(c)) fills.push(c)
  }
  return fills
}

/** Apply vivid slice fills; legend colors used when present and distinct */
function enforcePieChartColors(svg) {
  if (!/pieTitleText|pieCircle|pie-/i.test(svg)) return svg

  const fromLegend = extractLegendColors(svg)
  const palette =
    fromLegend.length >= 2 && new Set(fromLegend).size >= 2 ? fromLegend : PIE_SLICE_COLORS

  let sliceIdx = 0

  const colorizePaths = (chunk) =>
    chunk.replace(/<path\b([^>]*?)>/gi, (full, attrs) => {
      if (!/\bd="[^"]*A/i.test(attrs)) return full
      const color = palette[sliceIdx % palette.length]
      sliceIdx += 1
      let next = attrs
        .replace(/\bfill="[^"]*"/gi, '')
        .replace(/\bstroke="[^"]*"/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
      return `<path fill="${color}" stroke="#ffffff" stroke-width="2" ${next}>`
    })

  const pieGroup = svg.match(/<g[^>]*class="[^"]*pieCircle[^"]*"[^>]*>([\s\S]*?)<\/g>/i)
  if (pieGroup) {
    const colored = colorizePaths(pieGroup[1])
    return svg.replace(pieGroup[1], colored)
  }

  sliceIdx = 0
  return colorizePaths(svg)
}

function enforcePieLabelContrast(svg) {
  return svg
    .replace(/(<text\b[^>]*?)\sfill="[^"]*"/gi, '$1 fill="#0f172a"')
    .replace(/(<tspan\b[^>]*?)\sfill="[^"]*"/gi, '$1 fill="#0f172a"')
}

function scalePieSvg(svg) {
  return svg.replace(/<svg\b([^>]*)>/i, (match, attrs) => {
    let next = attrs
      .replace(/\bwidth="[^"]*"/i, '')
      .replace(/\bheight="[^"]*"/i, '')
      .replace(/\bstyle="[^"]*"/i, '')
    return `<svg${next} width="100%" style="min-width:520px;max-width:720px;min-height:400px;height:auto;display:block;margin:0 auto">`
  })
}

const FLOW_EDGE_LABEL_DARK = '#0f172a'

/** Edge labels use .label styles — they wrongly inherit white nodeTextColor */
function enforceFlowEdgeLabelContrast(svg) {
  if (!/edgeLabels|edgeLabel/i.test(svg)) return svg

  const stylePatch = `
.edgeLabels .edgeLabel text,
.edgeLabels .edgeLabel tspan,
.edgeLabels .edgeLabel span,
.edgeLabels .edgeLabel .label text,
.edgeLabels .edgeLabel .label span,
.edgeLabels .edgeLabel foreignObject,
.edgeLabels .edgeLabel foreignObject div,
.edgeLabels .edgeLabel foreignObject span,
.edgeLabels .edgeLabel .labelBkg {
  fill: ${FLOW_EDGE_LABEL_DARK} !important;
  color: ${FLOW_EDGE_LABEL_DARK} !important;
}
.edgeLabels .edgeLabel rect.labelBkg,
.edgeLabels .edgeLabel .label rect {
  fill: #ffffff !important;
  opacity: 1 !important;
}
`

  let out = svg
  if (out.includes('</style>')) {
    out = out.replace('</style>', `${stylePatch}</style>`)
  }

  const edgeBlock = out.match(/<g[^>]*class="[^"]*edgeLabels[^"]*"[^>]*>[\s\S]*?<\/g>/i)
  if (edgeBlock) {
    const fixed = edgeBlock[0]
      .replace(/(<text\b[^>]*?)\sfill="[^"]*"/gi, `$1 fill="${FLOW_EDGE_LABEL_DARK}"`)
      .replace(/(<tspan\b[^>]*?)\sfill="[^"]*"/gi, `$1 fill="${FLOW_EDGE_LABEL_DARK}"`)
      .replace(
        /(<span[^>]*class="[^"]*edgeLabel[^"]*"[^>]*)(>)/gi,
        `$1 style="color:${FLOW_EDGE_LABEL_DARK}"$2`
      )
    out = out.replace(edgeBlock[0], fixed)
  }

  return out
}

function buildMermaidConfig(code) {
  const flowchart = isFlowchart(code)
  const pie = isPieChart(code)

  const themeVariables = flowchart
    ? {
        primaryTextColor: '#ffffff',
        nodeTextColor: '#ffffff',
        textColor: '#0f172a',
        lineColor: '#334155',
        primaryColor: '#1e3a8a',
        primaryBorderColor: '#0f172a',
        edgeLabelBackground: '#ffffff',
        fontFamily: FONT
      }
    : {
        textColor: '#0f172a',
        titleColor: '#0f172a',
        lineColor: '#334155',
        pie1: PIE_SLICE_COLORS[0],
        pie2: PIE_SLICE_COLORS[1],
        pie3: PIE_SLICE_COLORS[2],
        pie4: PIE_SLICE_COLORS[3],
        pie5: PIE_SLICE_COLORS[4],
        pie6: PIE_SLICE_COLORS[5],
        pie7: PIE_SLICE_COLORS[6],
        pieTitleTextSize: '28px',
        pieLegendTextSize: '18px',
        pieSectionTextSize: '17px',
        pieStrokeColor: '#ffffff',
        pieStrokeWidth: '2px',
        pieOuterStrokeWidth: '2px',
        pieOuterStrokeColor: '#e5e7eb',
        fontFamily: FONT
      }

  const config = {
    startOnLoad: false,
    securityLevel: 'loose',
    suppressErrorRendering: true,
    theme: pie ? 'default' : 'base',
    themeVariables,
    flowchart: flowchart
      ? { htmlLabels: false, curve: 'linear' }
      : undefined
  }

  if (pie) {
    config.pie = { useMaxWidth: false }
  }

  return config
}

function postProcessSvg(svg, { pie, flowchart }) {
  let out = svg
  if (pie) {
    out = enforcePieChartColors(out)
    out = enforcePieLabelContrast(out)
    out = scalePieSvg(out)
  }
  if (flowchart) {
    out = enforceFlowEdgeLabelContrast(out)
  }
  return out
}

/** Mermaid embeds `.error-text` in every diagram's CSS — only match real error output */
function isMermaidErrorSvg(svg) {
  const s = String(svg || '')
  if (/Syntax error in text/i.test(s)) return true
  if (/viewBox="0 0 2412 512"/.test(s)) return true
  if (/<path[^>]*class="error-icon"/i.test(s)) return true
  return false
}

export default function MermaidDiagram({ code }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)
  const id = useMemo(() => `mermaid-${Math.random().toString(36).slice(2, 10)}`, [])
  const flowchart = useMemo(() => isFlowchart(code), [code])
  const pie = useMemo(() => isPieChart(code), [code])

  useEffect(() => {
    let cancelled = false
    const diagramCode = normalizeMermaidSource(code)

    async function renderDiagram() {
      cleanupMermaidDom(id)
      try {
        const mermaid = await loadMermaid()
        mermaid.initialize(buildMermaidConfig(diagramCode))
        const result = await mermaid.render(id, diagramCode)
        cleanupMermaidDom(id)
        if (!result?.svg || isMermaidErrorSvg(result.svg)) {
          throw new Error(result?.svg ? 'Mermaid syntax error' : 'Mermaid returned empty SVG')
        }
        if (!cancelled) {
          setSvg(postProcessSvg(result.svg, { pie, flowchart }))
          setError(false)
        }
      } catch (e) {
        cleanupMermaidDom(id)
        console.warn('Mermaid render failed:', diagramCode.slice(0, 200), e)
        if (!cancelled) {
          setSvg('')
          setError(true)
        }
      }
    }

    setSvg('')
    setError(false)
    renderDiagram()
    return () => {
      cancelled = true
      cleanupMermaidDom(id)
    }
  }, [code, id, pie, flowchart])

  if (error) {
    return (
      <div style={{ margin: '24px 0', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        <div
          style={{
            padding: '8px 12px',
            background: '#f3f4f6',
            fontSize: '11px',
            fontWeight: 600,
            color: '#6b7280',
            textTransform: 'uppercase'
          }}
        >
          Diagram (source)
        </div>
        <pre style={{ margin: 0, padding: '12px', fontSize: '12px', overflow: 'auto', background: '#fafafa' }}>
          <code>{stripMermaidFences(code)}</code>
        </pre>
      </div>
    )
  }

  const wrapClass = pie
    ? 'blog-preview-mermaid blog-preview-mermaid--pie'
    : flowchart
      ? 'blog-preview-mermaid blog-preview-mermaid--flow'
      : 'blog-preview-mermaid'

  return (
    <div
      style={{
        margin: '28px auto',
        maxWidth: pie ? '720px' : flowchart ? '680px' : '100%',
        padding: pie ? '24px 20px' : '20px 16px',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        background: '#fff',
        overflowX: 'auto',
        textAlign: 'center'
      }}
    >
      {svg ? (
        <div
          className={wrapClass}
          style={{ display: 'inline-block', width: pie ? '100%' : 'auto', maxWidth: '100%' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div style={{ fontSize: '13px', color: '#6b7280' }}>Rendering diagram…</div>
      )}
      <style>{`
        .blog-preview-mermaid svg {
          max-width: 100%;
          height: auto;
          margin: 0 auto;
        }
        .blog-preview-mermaid--pie svg {
          width: 100% !important;
          min-width: 520px;
          max-width: 720px;
          min-height: 400px;
        }
        .blog-preview-mermaid--pie .pieTitleText {
          font-size: 1.25rem !important;
          font-weight: 700 !important;
          fill: #0f172a !important;
        }
        .blog-preview-mermaid--pie .legend text {
          fill: #0f172a !important;
          font-size: 15px !important;
        }
        .blog-preview-mermaid--flow svg {
          min-width: 480px;
        }
        .blog-preview-mermaid--flow .edgeLabels .edgeLabel text,
        .blog-preview-mermaid--flow .edgeLabels .edgeLabel tspan,
        .blog-preview-mermaid--flow .edgeLabels .edgeLabel span,
        .blog-preview-mermaid--flow .edgeLabels .edgeLabel .label text,
        .blog-preview-mermaid--flow .edgeLabels .edgeLabel .label span {
          fill: #0f172a !important;
          color: #0f172a !important;
        }
        .blog-preview-mermaid--flow .edgeLabels foreignObject div,
        .blog-preview-mermaid--flow .edgeLabels foreignObject span {
          color: #0f172a !important;
        }
        .blog-preview-mermaid--flow .edgeLabels .labelBkg {
          background-color: #ffffff !important;
        }
      `}</style>
    </div>
  )
}
