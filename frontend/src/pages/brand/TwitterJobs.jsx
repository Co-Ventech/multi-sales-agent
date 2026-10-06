/**
 * Twitter Jobs — Fetch and manage job listings scraped from Twitter via Apify
 *
 * Actor: powerai~twitter-jobs-search-scraper
 * Two-step flow:
 *   Step 1: Enter keyword → Run Actor → Preview all jobs
 *   Step 2: Select jobs → Import to DB → Track & manage
 */
import React, { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import api, { SCRAPE_API_TIMEOUT_MS } from '../../api/client'

const STATUS_COLORS = {
  new:       { bg: '#ebf8ff', color: '#2b6cb0', border: '#bee3f8' },
  applied:   { bg: '#f0fff4', color: '#276749', border: '#9ae6b4' },
  interview: { bg: '#fffaf0', color: '#c05621', border: '#feebc8' },
  offer:     { bg: '#f0fff4', color: '#22543d', border: '#68d391' },
  rejected:  { bg: '#fff5f5', color: '#c53030', border: '#feb2b2' },
  archived:  { bg: '#f7fafc', color: '#718096', border: '#e2e8f0' }
}

const STATUS_OPTIONS = ['new', 'applied', 'interview', 'offer', 'rejected', 'archived']

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.new
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.color, border: '1px solid ' + s.border
    }}>
      {status}
    </span>
  )
}

function formatJobLocationType(value) {
  if (value == null || value === '') return null
  const t = String(value).trim().replace(/_/g, ' ')
  if (!t) return null
  return t.replace(/\b\w/g, c => c.toUpperCase())
}

function JobCard({ job, onSelect, selected, onStatusChange, onDelete, brandId }) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes]     = useState(job.userNotes || '')
  const [saving, setSaving]   = useState(false)

  async function saveNotes() {
    setSaving(true)
    try {
      await api.put('/brands/' + brandId + '/twitter-jobs/' + job._id, { userNotes: notes })
      setEditing(false)
    } catch {}
    setSaving(false)
  }

  // Format salary display
  function formatSalary() {
    if (!job.formattedSalary && !job.salaryMin) return null
    if (job.formattedSalary) {
      return job.formattedSalary + (job.salaryInterval === 12 ? '/mo' : '/yr')
    }
    if (job.salaryMin) {
      const fmt = n => n >= 1000 ? (n / 1000) + 'K' : n
      if (job.salaryMax) return '$' + fmt(job.salaryMin) + ' - $' + fmt(job.salaryMax)
      return '$' + fmt(job.salaryMin) + 'K+'
    }
    return null
  }

  const salary = formatSalary()
  const locationTypeLabel = formatJobLocationType(job.jobLocationType)

  // Company logo image
  const companyLogoSrc = job.companyLogo || null

  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '18px 20px',
      background: selected ? '#ebf8ff' : '#fff',
      marginBottom: '10px',
      borderLeft: selected ? '4px solid #3182ce' : '4px solid transparent'
    }}>
      {/* Top row: checkbox + Company logo + Name + Title */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' }}>
        {onSelect && (
          <input type="checkbox" checked={selected} onChange={onSelect}
            style={{ marginTop: '4px', cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }} />
        )}
        {companyLogoSrc && (
          <img src={companyLogoSrc} alt={job.companyName || 'Company'}
            style={{ width: '44px', height: '44px', borderRadius: '8px', objectFit: 'contain', background: '#f7fafc', border: '1px solid #e2e8f0', flexShrink: 0 }} />
        )}
        {!companyLogoSrc && (
          <div style={{
            width: '44px', height: '44px', borderRadius: '8px', background: '#f0f4f8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px', fontWeight: 700, color: '#4a5568', flexShrink: 0
          }}>
            {(job.companyName || '?')[0]}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Company name + Title */}
          <div style={{ fontSize: '12px', color: '#718096', marginBottom: '2px', fontWeight: 500 }}>
            {job.companyName || 'Unknown Company'}
          </div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#1a202c', lineHeight: '1.3', marginBottom: '4px' }}>
            {job.title || '—'}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {job.location && (
              <span style={{ fontSize: '11px', color: '#4a5568', display: 'flex', alignItems: 'center', gap: '3px' }}>
                📍 {job.location}
              </span>
            )}
            <StatusBadge status={job.status} />
          </div>
        </div>
        {onDelete && (
          <button onClick={() => onDelete(job._id)} title="Delete job"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c53030', fontSize: '18px', padding: '2px 6px', flexShrink: 0 }}>
            ×
          </button>
        )}
      </div>

      {/* Location type (remote / onsite / hybrid from Apify) */}
      {locationTypeLabel && (
        <div style={{ marginBottom: '10px' }}>
          <span style={{
            fontSize: '12px', fontWeight: 600, color: '#234e52',
            padding: '5px 12px', background: '#e6fffa', border: '1px solid #81e6d9',
            borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px'
          }}>
            <span style={{ color: '#718096', fontWeight: 500 }}>Location type:</span>
            {locationTypeLabel}
          </span>
        </div>
      )}

      {/* Salary row */}
      {salary && (
        <div style={{ fontSize: '14px', color: '#2b6cb0', fontWeight: 700, marginBottom: '10px', padding: '6px 12px', background: '#ebf8ff', borderRadius: '8px', display: 'inline-block' }}>
          💰 {salary}
        </div>
      )}

      {/* Keyword tags */}
      {job.keyword && (
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {(Array.isArray(job.keyword) ? job.keyword : [job.keyword]).slice(0, 10).map(k => (
            <span key={k} style={{ fontSize: '11px', background: '#f7fafc', color: '#4a5568', padding: '3px 8px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>#{k}</span>
          ))}
        </div>
      )}

      {/* Poster row */}
      {job.posterName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '8px 10px', background: '#f7fafc', borderRadius: '8px' }}>
          {job.posterProfileUrl && (
            <img src={job.posterProfileUrl} alt={job.posterName} style={{ width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0 }} />
          )}
          <div style={{ fontSize: '12px', color: '#4a5568' }}>
            <span style={{ color: '#718096' }}>Posted by</span>{' '}
            <strong>{job.posterName}</strong>
            {job.posterScreenName && <span style={{ color: '#a0aec0' }}> (@{job.posterScreenName})</span>}
            {job.posterVerified && <span style={{ color: '#3182ce', marginLeft: '4px' }}>✓</span>}
          </div>
        </div>
      )}

      {/* Action buttons row */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: '10px' }}>
        {job.redirectUrl && (
          <a href={job.redirectUrl} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 14px', background: '#3182ce', color: '#fff', borderRadius: '6px', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
            Apply Now ↗
          </a>
        )}
        <select value={job.status} onChange={e => onStatusChange(job._id, e.target.value)}
          style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: '#fff' }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={() => setEditing(v => !v)}
          style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', padding: '5px 10px', color: '#4a5568' }}>
          {editing ? 'Cancel' : '📝 Notes'}
        </button>
        <span style={{ fontSize: '11px', color: '#a0aec0', marginLeft: 'auto' }}>
          Scraped {job.scrapedAt ? new Date(job.scrapedAt).toLocaleDateString() : ''}
        </span>
      </div>

      {/* Notes editor */}
      {editing && (
        <div style={{ marginTop: '10px', borderTop: '1px solid #f0f0f0', paddingTop: '10px' }}>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Add your notes about this job..."
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          <button onClick={saveNotes} disabled={saving}
            style={{ marginTop: '6px', padding: '5px 12px', background: '#276749', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
            {saving ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      )}
    </div>
  )
}

// Styles
const S = {
  inputStyle: { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' },
  primaryBtn: { padding: '9px 20px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' },
  secondaryBtn: { padding: '8px 16px', background: '#fff', color: '#3182ce', border: '1px solid #3182ce', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  smallBtn: { padding: '6px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: '#4a5568' },
  sectionStyle: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginBottom: '16px' },
  sectionTitle: { fontSize: '14px', fontWeight: 700, color: '#2d3748', marginBottom: '14px' },
  fieldRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' },
  field: { flex: '1 1 220px', minWidth: 0 },
  fieldLabel: { fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '4px', display: 'block' }
}

export default function TwitterJobs() {
  const { brandId } = useParams()
  const routerLoc = useLocation()

  const [jobs, setJobs]         = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)

  const [step, setStep]         = useState('list')
  const [keyword, setKeyword]   = useState('')
  const [count, setCount] = useState(100)
  const [jobLocationType, setJobLocationType] = useState('remote')
  const [apiToken, setApiToken] = useState('')
  const [running, setRunning]   = useState(false)
  const [runError, setRunError] = useState('')
  const [scrapedJobs, setScrapedJobs] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError]   = useState('')

  useEffect(() => {
    // Read brandId directly from window to avoid stale React Router state during navigation
    const urlBrandId = window.location.pathname.match(/\/brands\/([^/]+)/)?.[1]
    if (!urlBrandId) return
    fetchJobs(1)
  }, [statusFilter, routerLoc.pathname])

  async function fetchJobs(p) {
    const urlBrandId = window.location.pathname.match(/\/brands\/([^/]+)/)?.[1]
    if (!urlBrandId) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', p || 1)
      params.set('limit', 20)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      const r = await api.get('/brands/' + urlBrandId + '/twitter-jobs?' + params)
      setJobs(r.data.jobs)
      setTotal(r.data.total)
      setPage(r.data.page)
    } catch {}
    setLoading(false)
  }

  function handleSearchSubmit(e) {
    e.preventDefault()
    fetchJobs(1)
  }

  async function handleStatusChange(jobId, status) {
    try {
      await api.put('/brands/' + brandId + '/twitter-jobs/' + jobId, { status })
      setJobs(prev => prev.map(j => j._id === jobId ? { ...j, status } : j))
    } catch {}
  }

  async function handleDeleteJob(jobId) {
    if (!confirm('Delete this job?')) return
    try {
      await api.delete('/brands/' + brandId + '/twitter-jobs/' + jobId)
      setJobs(prev => prev.filter(j => j._id !== jobId))
      setTotal(prev => prev - 1)
    } catch {}
  }

  async function runScrape() {
    if (!keyword.trim()) return
    const max = parseInt(count, 10)
    if (!Number.isFinite(max) || max < 20) {
      setRunError('Max results must be 20 or above (Apify actor limit).')
      return
    }
    setRunError('')
    setRunning(true)
    setScrapedJobs([])
    setSelected(new Set())
    setImportResult(null)
    setImportError('')
    try {
      const payload = {
        keyword: keyword.trim(),
        maxResults: Math.min(Math.max(20, parseInt(count, 10) || 100), 1000),
        jobLocationType: jobLocationType.trim() || 'remote'
      }
      if (apiToken.trim()) payload.apiToken = apiToken.trim()
      const r = await api.post('/brands/' + brandId + '/twitter-jobs/run', payload, {
        timeout: SCRAPE_API_TIMEOUT_MS
      })
      setScrapedJobs(r.data.jobs || [])
      const allNew = new Set((r.data.jobs || []).filter(j => !j._exists).map(j => j.rest_id))
      setSelected(allNew)
    } catch (e) {
      setRunError(e.response ? e.response.data.error : e.message)
    }
    setRunning(false)
  }

  function toggleJob(rest_id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(rest_id)) next.delete(rest_id); else next.add(rest_id)
      return next
    })
  }

  const selectAllNew = () => setSelected(new Set(scrapedJobs.filter(j => !j._exists).map(j => j.rest_id)))
  const selectAll    = () => setSelected(new Set(scrapedJobs.map(j => j.rest_id)))
  const selectNone  = () => setSelected(new Set())

  async function importSelected() {
    const toImport = scrapedJobs.filter(j => selected.has(j.rest_id))
    if (!toImport.length) return
    setImporting(true)
    setImportError('')
    setImportResult(null)
    try {
      const r = await api.post('/brands/' + brandId + '/twitter-jobs/import', { jobs: toImport })
      setImportResult(r.data)
    } catch (e) {
      setImportError(e.response ? e.response.data.error : e.message)
    }
    setImporting(false)
  }

  if (step === 'scrape') {
    return (
      <div style={{ padding: '24px', maxWidth: '900px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
          <button onClick={() => setStep('list')} style={S.secondaryBtn}>← Back</button>
          <h2 style={{ margin: 0 }}>Scrape Twitter Jobs</h2>
        </div>

        <div style={S.sectionStyle}>
          <h3 style={S.sectionTitle}>Search Parameters</h3>
          <div style={S.fieldRow}>
            <div style={S.field}>
              <label style={S.fieldLabel}>Keyword <span style={{ color: '#e53e3e' }}>*</span></label>
              <input value={keyword} onChange={e => setKeyword(e.target.value)}
                placeholder="DevOps Engineer" style={S.inputStyle} />
            </div>
            <div style={{ flex: '0 0 160px' }}>
              <label style={S.fieldLabel}>
                Max results <small style={{ color: '#718096', fontWeight: 400 }}>(min 20)</small>
              </label>
              <input type="number" value={count} onChange={e => setCount(e.target.value)}
                min={20} max={1000} style={S.inputStyle} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={S.fieldLabel}>Location <small style={{ color: '#aaa' }}>(optional)</small></label>
              <input
                value={jobLocationType}
                onChange={e => setJobLocationType(e.target.value)}
                placeholder="remote"
                style={S.inputStyle}
              />
            </div>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={S.fieldLabel}>API Token <small style={{ color: '#aaa' }}>(leave blank to use saved)</small></label>
            <input type="password" value={apiToken} onChange={e => setApiToken(e.target.value)}
              placeholder="apify_api_..." style={{ ...S.inputStyle, maxWidth: '320px' }} />
          </div>
          <button onClick={runScrape} disabled={running || !keyword.trim()}
            style={{ ...S.primaryBtn, opacity: running || !keyword.trim() ? 0.5 : 1 }}>
            {running ? '⏳ Scraping...' : '▶ Scrape Jobs'}
          </button>
          {runError && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: '6px', color: '#c53030', fontSize: '13px' }}>
              {runError}
            </div>
          )}
        </div>

        {scrapedJobs.length > 0 && (
          <div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
              <span style={{ fontSize: '13px', color: '#4a5568', fontWeight: 500 }}>
                {selected.size} of {scrapedJobs.length} selected
              </span>
              <button onClick={selectAll} style={S.smallBtn}>All</button>
              <button onClick={selectAllNew} style={S.smallBtn}>New Only ({scrapedJobs.filter(j => !j._exists).length})</button>
              <button onClick={selectNone} style={S.smallBtn}>None</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {scrapedJobs.map(job => (
                <JobCard key={job.rest_id} job={job} selected={selected.has(job.rest_id)}
                  onSelect={() => toggleJob(job.rest_id)} onDelete={null}
                  onStatusChange={() => {}} brandId={brandId} />
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
              <button onClick={importSelected} disabled={importing || selected.size === 0}
                style={{ ...S.primaryBtn, opacity: selected.size === 0 ? 0.5 : 1 }}>
                {importing ? '⏳ Importing...' : 'Import Selected (' + selected.size + ')'}
              </button>
              {importResult && (
                <span style={{ fontSize: '13px', color: '#276749', padding: '6px 12px', background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: '6px' }}>
                  ✅ Imported {importResult.imported} jobs.{importResult.duplicatesSkipped > 0 ? ' (' + importResult.duplicatesSkipped + ' duplicates skipped.)' : ''}{importResult.message ? ' ' + importResult.message : ''}
                </span>
              )}
              {importError && (
                <span style={{ fontSize: '13px', color: '#c53030' }}>Error: {importError}</span>
              )}
            </div>
          </div>
        )}

        {running && (
          <div style={{ marginTop: '16px', padding: '14px', background: '#fffbeb', border: '1px solid #f6e05e', borderRadius: '8px', fontSize: '14px' }}>
            ⏳ Scraping Twitter Jobs — this takes 1–3 minutes. Do not close this page.
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0 }}>Twitter Jobs</h2>
        <button onClick={() => setStep('scrape')} style={S.primaryBtn}>+ Scrape Jobs</button>
      </div>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {['all', ...STATUS_OPTIONS].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); fetchJobs(1) }}
            style={{
              padding: '6px 12px', borderRadius: '8px', border: '1px solid',
              borderColor: statusFilter === s ? '#3182ce' : '#e2e8f0',
              background: statusFilter === s ? '#ebf8ff' : '#fff',
              color: statusFilter === s ? '#2b6cb0' : '#718096',
              fontSize: '12px', fontWeight: statusFilter === s ? 600 : 400,
              cursor: 'pointer'
            }}>
            {s === 'all' ? 'All (' + total + ')' : s}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search title, company, location..."
          style={{ ...S.inputStyle, flex: 1 }} />
        <button type="submit" style={S.secondaryBtn}>Search</button>
        {search ? <button type="button" onClick={() => { setSearch(''); fetchJobs(1) }} style={S.smallBtn}>Clear</button> : null}
      </form>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#718096' }}>Loading...</div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#f7fafc', borderRadius: '10px', color: '#718096' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>No jobs found</div>
          <div style={{ fontSize: '13px' }}>Run a scrape to fetch jobs from Twitter, or adjust your filters.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {jobs.map(job => (
            <JobCard key={job._id} job={job} selected={false}
              onSelect={null}
              onStatusChange={handleStatusChange}
              onDelete={handleDeleteJob} brandId={brandId} />
          ))}
        </div>
      )}

      {total > 20 && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' }}>
          <button onClick={() => fetchJobs(page - 1)} disabled={page === 1} style={S.smallBtn}>← Prev</button>
          <span style={{ padding: '6px 12px', fontSize: '13px', color: '#718096' }}>Page {page}</span>
          <button onClick={() => fetchJobs(page + 1)} disabled={jobs.length < 20} style={S.smallBtn}>Next →</button>
        </div>
      )}
    </div>
  )
}