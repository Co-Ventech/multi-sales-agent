/**
 * Dev: import from src/vendor (Vite can transform it).
 * Prod: load /vendor/mermaid.bundle.mjs from public/ (copied to dist, not bundled — avoids server OOM).
 */

let loadPromise = null

function mermaidVendorUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}vendor/mermaid.bundle.mjs`
}

function resolveMermaidApi(mod) {
  const api = mod?.default ?? mod
  if (typeof api?.render !== 'function') {
    throw new Error('Mermaid bundle missing render()')
  }
  return api
}

export function stripMermaidFences(code) {
  let s = String(code || '').trim()
  const fence = s.match(/^```(?:mermaid)?\s*\n([\s\S]*?)```\s*$/i)
  if (fence) s = fence[1].trim()
  return s
    .replace(/\r\n/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
}

function dedentLines(code) {
  const lines = code.split('\n')
  if (lines.length < 2) return code.trim()
  const body = lines.slice(1).filter((l) => l.trim())
  if (!body.length) return lines[0].trim()
  const minIndent = Math.min(...body.map((l) => (l.match(/^(\s*)/)?.[1] || '').length))
  if (!minIndent) return code.trim()
  return [lines[0].trim(), ...lines.slice(1).map((l) => l.slice(minIndent))].join('\n').trim()
}

/** Normalize LLM-generated mermaid (indent, pie title, legacy edge labels) */
export function normalizeMermaidSource(code) {
  let s = dedentLines(stripMermaidFences(code))

  if (/^\s*pie\b/im.test(s)) {
    s = s.replace(
      /^\s*pie\s*\n\s*title\s+(.+)$/im,
      (_, title) => `pie title "${String(title).trim().replace(/^"|"$/g, '')}"`
    )
  }

  if (/^\s*(flowchart|graph)\b/im.test(s)) {
    s = s.replace(
      /^(\s*[\w-]+)\s+--\s+([^-\n]+?)\s+-->\s*(\S+)/gm,
      (_, from, label, to) => `${from.trim()} -->|${label.trim()}| ${to.trim()}`
    )
  }

  return s.trim()
}

export async function loadMermaid() {
  if (loadPromise) return loadPromise

  if (import.meta.env.DEV) {
    loadPromise = import('../vendor/mermaid.bundle.mjs').then(resolveMermaidApi)
  } else {
    const url = mermaidVendorUrl()
    loadPromise = import(/* @vite-ignore */ url).then(resolveMermaidApi)
  }

  return loadPromise
}

export function cleanupStrayMermaidArtifacts() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('.error-text, .error-icon').forEach((el) => {
    const host =
      el.closest('[id^="d"]') ||
      el.closest('[id^="mermaid-"]') ||
      el.closest('div')
    host?.remove()
  })
  document.querySelectorAll('[id^="dmermaid-"], [id^="imermaid-"]').forEach((el) => el.remove())
}

export function cleanupMermaidDom(renderId) {
  if (typeof document === 'undefined' || !renderId) return
  for (const domId of [renderId, `d${renderId}`, `i${renderId}`]) {
    document.getElementById(domId)?.remove()
  }
}
