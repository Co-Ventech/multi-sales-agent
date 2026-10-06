/** Bold label lines like "**Why it matters:**" — not a list item */
function isLabelBullet(text) {
  const t = String(text || '').trim()
  return /^\*\*[^*]+\*\*:?\s*$/.test(t)
}

function labelBulletToHeading(text) {
  return String(text || '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/:$/, '')
    .trim()
}

function normalizeHeadingKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[`*_#]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function markdownTableToBlock(block, idPrefix, idx) {
  const lines = String(block || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 3) return null
  if (!lines[0].startsWith('|') || !lines[1].startsWith('|')) return null
  if (!/^\|[-:\s|]+\|$/.test(lines[1])) return null
  const headers = lines[0].split('|').map((x) => x.trim()).filter(Boolean)
  const rows = lines.slice(2).map((ln) =>
    ln.split('|').map((x) => x.trim()).filter(Boolean)
  )
  if (!headers.length || !rows.length) return null
  return { id: `${idPrefix}-${idx}`, type: 'table', headers, rows }
}

/**
 * Parse blog body markdown into render blocks (headings, lists, code/mermaid, tables, images).
 */
export function markdownToPreviewBlocks(markdown, sectionImages = []) {
  const lines = String(markdown || '').split('\n')
  const sections = []
  let paraBuf = []
  let tableBuf = []
  let codeBuf = []
  let inCode = false
  let codeLang = ''
  let blockIdx = 1

  const isTableLine = (line) => /^\s*\|/.test(String(line || '').trim())

  const flushTable = () => {
    if (!tableBuf.length) return
    const tableBlock = markdownTableToBlock(tableBuf.join('\n'), 'table', blockIdx)
    if (tableBlock) {
      sections.push(tableBlock)
      blockIdx += 1
    } else {
      for (const ln of tableBuf) paraBuf.push(ln)
    }
    tableBuf = []
  }

  const pendingByHeading = new Map()
  for (const img of Array.isArray(sectionImages) ? sectionImages : []) {
    const key = normalizeHeadingKey(img?.sectionTitle || img?.title || '')
    if (!key) continue
    if (!pendingByHeading.has(key)) pendingByHeading.set(key, [])
    pendingByHeading.get(key).push(img)
  }

  let bulletBuf = []

  const flushBullets = () => {
    if (!bulletBuf.length) return
    sections.push({ id: `ul-${blockIdx}`, type: 'bulletList', items: [...bulletBuf] })
    blockIdx += 1
    bulletBuf = []
  }

  const flushTextParagraph = () => {
    flushBullets()
    const raw = paraBuf.join('\n').trim()
    paraBuf = []
    if (!raw) return
    const tableBlock = markdownTableToBlock(raw, 'table', blockIdx)
    if (tableBlock) {
      sections.push(tableBlock)
      blockIdx += 1
      return
    }
    const text = raw.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) return
    if (/^[-*]\s+/.test(text)) {
      const items = text.split(/\s+[-*]\s+/).map((s) => s.trim()).filter(Boolean)
      if (items.length > 1) {
        sections.push({ id: `ul-${blockIdx}`, type: 'bulletList', items })
        blockIdx += 1
        return
      }
    }
    sections.push({ id: `p-${blockIdx}`, type: 'paragraph', text })
    blockIdx += 1
  }

  const flushParagraph = () => {
    flushTextParagraph()
    flushTable()
  }

  const flushCode = () => {
    if (!codeBuf.length) return
    sections.push({
      id: `code-${blockIdx}`,
      type: 'code',
      language: codeLang || 'text',
      code: codeBuf.join('\n').trim()
    })
    blockIdx += 1
    codeBuf = []
    codeLang = ''
  }

  for (const raw of lines) {
    const line = raw || ''
    const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/)
    if (fence) {
      if (!inCode) {
        flushParagraph()
        inCode = true
        codeLang = fence[1] || 'text'
      } else {
        flushCode()
        inCode = false
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      const bulletText = bullet[1].trim()
      if (isLabelBullet(bulletText)) {
        flushParagraph()
        sections.push({
          id: `label-${blockIdx}`,
          type: 'subheading',
          text: labelBulletToHeading(bulletText)
        })
        blockIdx += 1
        continue
      }
      flushTextParagraph()
      flushTable()
      bulletBuf.push(bulletText)
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)\s*$/)
    if (heading) {
      flushParagraph()
      const headingText = heading[2].trim()
      const level = heading[1].length
      sections.push({
        id: `h${level}-${blockIdx}`,
        type: level <= 2 ? 'heading' : 'subheading',
        level,
        text: headingText
      })
      blockIdx += 1
      const imgs = pendingByHeading.get(normalizeHeadingKey(headingText)) || []
      for (const img of imgs) {
        if (img?.relativePath) {
          sections.push({
            id: `img-${blockIdx}`,
            type: 'image',
            src: img.relativePath,
            alt: img.sectionTitle || headingText
          })
          blockIdx += 1
        }
      }
      pendingByHeading.delete(normalizeHeadingKey(headingText))
      continue
    }

    if (isTableLine(line)) {
      flushTextParagraph()
      tableBuf.push(line.trim())
      continue
    }
    if (tableBuf.length) {
      flushTable()
    }

    if (!line.trim()) {
      flushTextParagraph()
      flushTable()
      continue
    }
    paraBuf.push(line.trim())
  }
  flushParagraph()
  flushBullets()
  flushTable()
  if (inCode) flushCode()

  return sections
}
