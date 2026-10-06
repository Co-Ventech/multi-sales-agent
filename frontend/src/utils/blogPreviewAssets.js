/** Pipeline run id embedded in artifact filenames, e.g. 1779375757386-dqqaleu */
export function pipelineRunIdFromRun(run) {
  const sources = [
    run?.draft?.heroImage?.relativePath,
    run?.draft?.heroImage?.filename,
    run?.steps?.heroImage?.path,
    run?.artifacts?.draftPath,
    run?.artifacts?.trendsPath
  ]
  for (const s of sources) {
    const m = String(s || '').replace(/\\/g, '/').match(/(\d{13,}-[a-z0-9]+)/i)
    if (m) return m[1]
  }
  return null
}

function imageFilenameFromPath(value) {
  if (!value) return ''
  const raw = String(value).replace(/\\/g, '/').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  let pathPart = raw.startsWith('/') ? raw.slice(1) : raw
  pathPart = pathPart.replace(/^data\/runs\//i, '')
  if (pathPart.includes('/')) {
    pathPart = pathPart.split('/').pop() || pathPart
  }
  return pathPart
}

/**
 * Same-origin /api URL so Vite proxy (dev) and combined deploy (prod) serve local PNGs.
 * Do not use VITE_API_URL here — that often points at a remote host without image files.
 */
export function blogAssetUrl(relativePath) {
  const pathPart = imageFilenameFromPath(relativePath)
  if (!pathPart) return ''
  if (/^https?:\/\//i.test(pathPart)) return pathPart

  const apiBase =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api`
      : (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

  return `${apiBase}/blog-pipeline/files/${encodeURIComponent(pathPart)}`
}

export function blogHeroUrl(run) {
  const hi = run?.draft?.heroImage
  const fromMeta = blogAssetUrl(
    hi?.relativePath || hi?.filename || run?.steps?.heroImage?.path
  )
  if (fromMeta) return fromMeta
  const runId = pipelineRunIdFromRun(run)
  return runId ? blogAssetUrl(`${runId}-hero.png`) : ''
}

export function blogSectionImageUrl(img, run, sectionIndex) {
  const fromMeta = blogAssetUrl(img?.relativePath || img?.filename)
  if (fromMeta) return fromMeta
  const runId = pipelineRunIdFromRun(run)
  const idx = sectionIndex != null ? sectionIndex + 1 : ''
  return runId && idx ? blogAssetUrl(`${runId}-section-${idx}.png`) : ''
}
