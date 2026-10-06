import React, { useState, useEffect } from 'react'
import apiClient from '../../api/client'
import BlogArticlePreview from '../../components/blog/BlogArticlePreview'
import { blogHeroUrl } from '../../utils/blogPreviewAssets'

// AI-focused industry coverage — used when the user leaves the Search Terms
// input empty. Kept in sync with the backend fallback in
// src/api/routes/blogPipeline.js and src/config/marketing.js.
const DEFAULT_SEARCH_TERMS = 'AI agents, RAG systems, prompt engineering, '

const styles = {
  page: { padding: '24px', maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '10px', marginBottom: '24px' },
  title: { fontSize: '22px', fontWeight: '700', color: '#222', marginRight: '16px' },
  runBtn: {
    padding: '10px 20px', background: '#0f3460', color: '#fff',
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600'
  },
  controlsRow: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' },
  label: { fontSize: '12px', color: '#666', fontWeight: '600' },
  select: { padding: '6px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px' },
  runsList: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '24px' },
  runRow: {
    display: 'flex', alignItems: 'center', gap: '16px',
    border: '1px solid #e0e0e0', borderRadius: '12px', padding: '14px 18px',
    background: '#fff', cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s, background 0.15s',
    minHeight: '64px'
  },
  runRowHover: { background: '#f8faff', borderColor: '#c0d0e8' },
  runRowActive: { boxShadow: '0 0 0 2px #0f3460', borderColor: '#0f3460' },
  runTopic: { fontSize: '15px', fontWeight: '600', color: '#333', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusBadge: {
    padding: '4px 12px', borderRadius: '12px', fontSize: '11px', fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: '0.5px'
  },
  runMeta: { fontSize: '12px', color: '#888', minWidth: '170px' },
  stepsRow: { display: 'flex', gap: '4px', flexWrap: 'wrap', minWidth: '200px' },
  stepChip: {
    padding: '2px 8px', borderRadius: '4px', fontSize: '10px',
    fontWeight: '600', background: '#f0f0f0', color: '#555'
  },
  modal: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
  },
  modalContent: {
    background: '#fff', borderRadius: '16px', padding: '32px', maxWidth: '860px', width: '92%',
    maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #eee' },
  modalTitle: { fontSize: '20px', fontWeight: '700', color: '#222', lineHeight: '1.3' },
  closeBtn: { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#aaa', padding: '0 4px', lineHeight: '1' },
  closeBtnHover: { color: '#333' },
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' },
  detailLabel: { fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', fontWeight: '600' },
  detailValue: { fontSize: '14px', color: '#333', fontWeight: '500' },
  markdown: {
    background: '#f8f8f8', borderRadius: '10px', padding: '16px', fontSize: '13px',
    lineHeight: '1.7', whiteSpace: 'pre-wrap', maxHeight: '420px', overflowY: 'auto',
    border: '1px solid #e0e0e0', marginTop: '8px'
  },
  actionRow: { display: 'flex', gap: '10px', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #eee' },
  approveBtn: { padding: '10px 22px', background: '#27ae60', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
  rejectBtn: { padding: '10px 22px', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
  deleteBtn: { padding: '10px 22px', background: '#999', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
  errorBox: { background: '#fee', border: '1px solid #f00', borderRadius: '8px', padding: '12px', color: '#c00', fontSize: '13px', marginTop: '12px' },
  emptyState: { textAlign: 'center', padding: '48px', color: '#888', fontSize: '14px' },
  spinner: { display: 'inline-block', width: '16px', height: '16px', border: '2px solid #0f3460', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' },
  heroImage: { width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '10px', marginTop: '12px' },
  suggestModal: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
  },
  suggestContent: {
    background: '#fff', borderRadius: '16px', padding: '28px', maxWidth: '720px', width: '92%',
    maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  suggestTitle: { fontSize: '18px', fontWeight: '700', color: '#222', marginBottom: '6px' },
  suggestSubtitle: { fontSize: '12px', color: '#888', marginBottom: '20px' },
  topicCard: {
    border: '1px solid #e0e0e0', borderRadius: '10px', padding: '14px 16px',
    cursor: 'pointer', transition: 'all 0.15s', marginBottom: '8px', background: '#fff'
  },
  topicCardActive: { borderColor: '#0f3460', boxShadow: '0 0 0 2px #0f3460' },
  topicPhrase: { fontSize: '14px', fontWeight: '600', color: '#333', marginBottom: '6px' },
  topicMeta: { display: 'flex', gap: '12px', flexWrap: 'wrap' },
  topicBadge: { padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: '600' },
  suggestActions: { display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' },
  generateBtn: { padding: '10px 24px', background: '#0f3460', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
  cancelBtn: { padding: '10px 24px', background: '#fff', color: '#666', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
  previewBtn: {
    padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none',
    borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', marginRight: '8px'
  },
  previewOverlay: {
    position: 'fixed', inset: 0, zIndex: 1100, background: '#fff',
    display: 'flex', flexDirection: 'column'
  },
  previewToolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 20px', borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0
  },
  previewScroll: { flex: 1, overflowY: 'auto', minHeight: 0 }
}

const TIME_RANGE_OPTIONS = [
  { label: 'Last 24 hours', value: 'today' },
  { label: 'Last 3 days', value: 'past 3 days' },
  { label: 'Last 7 days', value: 'this week' },
  { label: 'Last 30 days', value: 'this month' }
]

const STATUS_COLORS = {
  pending: { bg: '#eee', color: '#888' },
  running: { bg: '#e3f0ff', color: '#0f3460' },
  completed: { bg: '#e8f5e9', color: '#27ae60' },
  failed: { bg: '#fee', color: '#e74c3c' },
  approved: { bg: '#e8f5e9', color: '#27ae60' },
  rejected: { bg: '#fee', color: '#e74c3c' },
  published: { bg: '#e8f5e9', color: '#27ae60' }
}

const STEP_ORDER = ['trends', 'keywordFilter', 'topicScoring', 'serp', 'draft', 'heroImage', 'sectionImages', 'seoApproval']

export default function BlogDashboard() {
  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState(null)
  const [running, setRunning] = useState(false)
  const [polling, setPolling] = useState(null)
  const [timeRange, setTimeRange] = useState('this week')
  const [countryCode, setCountryCode] = useState('')
  const [searchTerms, setSearchTerms] = useState('')
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [hoveredId, setHoveredId] = useState(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestCandidates, setSuggestCandidates] = useState([])
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [recommendedPhrase, setRecommendedPhrase] = useState(null)
  const [customTopic, setCustomTopic] = useState('')
  const [generatingCustom, setGeneratingCustom] = useState(false)
  const [searchTermsError, setSearchTermsError] = useState('')

  useEffect(() => {
    setLoadingRuns(true)
    apiClient.get('/blog-pipeline/runs')
      .then(r => { setRuns(r.data); setLoadingRuns(false) })
      .catch(() => setLoadingRuns(false))
  }, [])

  useEffect(() => {
    if (!polling) return
    const id = setInterval(async () => {
      try {
        const r = await apiClient.get(`/blog-pipeline/runs/${polling}`)
        const run = r.data
        setRuns(prev => prev.map(r => r._id === run._id ? run : r))
        if (run.status !== 'pending' && run.status !== 'running') {
          setPolling(null)
          if (selectedRun?._id === run._id) setSelectedRun(run)
        } else {
          if (selectedRun?._id === run._id) setSelectedRun(run)
        }
      } catch {}
    }, 3000)
    return () => clearInterval(id)
  }, [polling, selectedRun])

  const startRun = async () => {
    if (!searchTerms.trim()) {
      setSearchTermsError('Please enter search terms (e.g. AI agents, MLOps, LLM applications...)')
      return
    }
    setRunning(true)
    try {
      const effectiveSearchTerms = searchTerms.trim()
      const r = await apiClient.post('/blog-pipeline/run', { brandId: 'marketing-agent', timeRange, countryCode, searchTerms: effectiveSearchTerms })
      setPolling(r.data.runId)
      setRuns(prev => [{ _id: r.data.runId, status: 'pending', timeRange, countryCode, searchTerms: effectiveSearchTerms, createdAt: new Date().toISOString() }, ...prev])
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start pipeline')
    } finally {
      setRunning(false)
    }
  }

  const approveRun = async (id) => {
    await apiClient.post(`/blog-pipeline/${id}/approve`)
    setRuns(prev => prev.map(r => r._id === id ? { ...r, status: 'approved' } : r))
    if (selectedRun?._id === id) setSelectedRun(prev => ({ ...prev, status: 'approved' }))
  }

  const rejectRun = async (id) => {
    await apiClient.post(`/blog-pipeline/${id}/reject`)
    setRuns(prev => prev.map(r => r._id === id ? { ...r, status: 'rejected' } : r))
    if (selectedRun?._id === id) setSelectedRun(prev => ({ ...prev, status: 'rejected' }))
  }

  const deleteRun = async (id) => {
    if (!window.confirm('Delete this run?')) return
    await apiClient.delete(`/blog-pipeline/${id}`)
    setRuns(prev => prev.filter(r => r._id !== id))
    if (selectedRun?._id === id) setSelectedRun(null)
  }

  const postRun = async (id) => {
    try {
      await apiClient.post(`/blog-pipeline/${id}/post`)
      setRuns(prev => prev.map(r => r._id === id ? { ...r, status: 'published' } : r))
      if (selectedRun?._id === id) setSelectedRun(prev => ({ ...prev, status: 'published' }))
    } catch (err) {
      alert(err.response?.data?.error || 'Post failed')
    }
  }

  const applySuggestResult = (raw) => {
    let candidates = []
    if (Array.isArray(raw)) {
      candidates = raw
    } else if (raw && typeof raw === 'object') {
      candidates = Array.isArray(raw.candidates) ? raw.candidates : []
    }
    setSuggestCandidates(candidates)

    const pickedPhrase = raw?.picked?.phrase || null
    setRecommendedPhrase(pickedPhrase)
    const preselect = pickedPhrase
      ? candidates.find(c => c.phrase === pickedPhrase) || raw.picked
      : candidates[0] || null
    if (preselect) setSelectedTopic(preselect)
  }

  const openSuggest = async () => {
    if (!searchTerms.trim()) {
      setSearchTermsError('Please enter search terms (e.g. AI agents, MLOps, LLM applications...)')
      return
    }
    setSuggestOpen(true)
    setSuggestLoading(true)
    setSuggestCandidates([])
    setSelectedTopic(null)
    setRecommendedPhrase(null)
    try {
      const effectiveSearchTerms = searchTerms.trim()
      const startRes = await apiClient.post('/blog-pipeline/suggest', { countryCode, timeRange, searchTerms: effectiveSearchTerms })
      const jobId = startRes.data?.jobId
      if (!jobId) {
        applySuggestResult(startRes.data)
        return
      }

      const maxPolls = 180
      let raw = null
      for (let i = 0; i < maxPolls; i++) {
        const pollRes = await apiClient.get(`/blog-pipeline/suggest/jobs/${jobId}`)
        const job = pollRes.data
        if (job.status === 'done') {
          raw = job
          break
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'Topic analysis failed')
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      if (!raw) throw new Error('Topic analysis timed out. Try again.')
      applySuggestResult(raw)
    } catch (err) {
      console.error('[Suggest] error:', err.message, err.response?.data)
      const msg = err.code === 'ECONNABORTED'
        ? 'Topic analysis timed out. Try again or use a shorter time range.'
        : (err.response?.data?.error || err.message || 'Failed to get topic suggestions')
      alert(msg)
    } finally {
      setSuggestLoading(false)
    }
  }

  const startRunWithTopic = async () => {
    if (!selectedTopic) return

    setSuggestOpen(false)
    setRunning(true)
    try {
      const r = await apiClient.post('/blog-pipeline/run', {
        brandId: 'marketing-agent',
        countryCode,
        timeRange,
        searchTerms,
        topic: selectedTopic.phrase
      })
      setPolling(r.data.runId)
      setRuns(prev => [{
        _id: r.data.runId,
        status: 'pending',
        timeRange,
        countryCode,
        searchTerms,
        createdAt: new Date().toISOString(),
        topic: { phrase: selectedTopic.phrase }
      }, ...prev])
    } catch (err) {
      const stuckRunId = err.response?.data?.runId
      if (err.response?.status === 409 && stuckRunId) {
        const retry = window.confirm(
          'A previous blog pipeline is still marked as running (likely stuck). Cancel it and start a new draft?'
        )
        if (retry) {
          try {
            await apiClient.post(`/blog-pipeline/${stuckRunId}/cancel`)
            setRuns(prev => prev.map(r => r._id === stuckRunId ? { ...r, status: 'failed' } : r))
            return startRunWithTopic()
          } catch (cancelErr) {
            alert(cancelErr.response?.data?.error || 'Failed to cancel stuck run')
          }
        }
      } else {
        alert(err.response?.data?.error || 'Failed to start pipeline')
      }
    } finally {
      setRunning(false)
    }
  }

  const generateCustomTopic = async () => {
    const topic = customTopic.trim()
    if (!topic) return

    setGeneratingCustom(true)
    setRunning(true)
    try {
      const r = await apiClient.post('/blog-pipeline/run', {
        brandId: 'marketing-agent',
        countryCode,
        timeRange,
        searchTerms,
        topic
      })
      setPolling(r.data.runId)
      setRuns(prev => [{
        _id: r.data.runId,
        status: 'pending',
        timeRange,
        countryCode,
        searchTerms,
        createdAt: new Date().toISOString(),
        topic: { phrase: topic }
      }, ...prev])
      setCustomTopic('')
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start pipeline')
    } finally {
      setRunning(false)
      setGeneratingCustom(false)
    }
  }

  const formatDate = (d) => d ? new Date(d).toLocaleString() : '—'

  const renderStepChips = (steps) => {
    if (!steps) return null
    return STEP_ORDER.map(key => {
      const step = steps[key]
      if (!step) return null
      const status = step.status || 'pending'
      return (
        <span key={key} style={{ ...styles.stepChip, background: status === 'done' ? '#e8f5e9' : status === 'failed' ? '#fee' : '#f0f0f0', color: status === 'done' ? '#27ae60' : status === 'failed' ? '#e74c3c' : '#888' }}>
          {key} {status === 'done' ? '✓' : status === 'failed' ? '✗' : '○'}
        </span>
      )
    })
  }

  return (
    <div style={styles.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={styles.header}>
        <div style={styles.title}>Blog Pipeline</div>
        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
          <button style={styles.runBtn} onClick={startRun} disabled={running}>
            {running ? '⏳ Running…' : '▶ Run Agent'}
          </button>
          <button style={{ ...styles.runBtn, background: '#27ae60' }} onClick={openSuggest}>
            💡 Suggest Topics
          </button>
        </div>
      </div>

      <div style={styles.controlsRow}>
        <label style={styles.label}>Time Range:</label>
        <select style={styles.select} value={timeRange} onChange={e => setTimeRange(e.target.value)}>
          {TIME_RANGE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label style={{ ...styles.label, marginLeft: '12px' }}>Country: <span style={{ color: '#999', fontWeight: '400', fontSize: '11px' }}>(Optional)</span></label>
        <input style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', width: '160px' }} value={countryCode} onChange={e => setCountryCode(e.target.value)} placeholder="Country" />
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginTop: '10px', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', width: '100%' }}>
          <label style={{ ...styles.label, marginRight: '4px' }}>Search Terms: <span style={{ color: '#e74c3c' }}>*</span></label>
          <input
            style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', border: searchTermsError ? '1px solid #e74c3c' : '1px solid #ddd', fontSize: '13px', maxWidth: '700px', outline: 'none' }}
            value={searchTerms}
            onChange={e => { setSearchTerms(e.target.value); if (searchTermsError) setSearchTermsError('') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openSuggest() } }}
            placeholder="e.g. AI agents, MLOps, LLM applications, RAG systems..."
            required
          />
        </div>
        {searchTermsError && (
          <div style={{ color: '#e74c3c', fontSize: '12px', marginLeft: '90px', marginTop: '-4px' }}>
            ⚠ {searchTermsError}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '12px' }}>
        <label style={{ ...styles.label, marginRight: '4px' }}>Or enter a topic: <span style={{ color: '#e74c3c' }}>*</span></label>
        <input
          style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', maxWidth: '500px' }}
          value={customTopic}
          onChange={e => setCustomTopic(e.target.value)}
          placeholder="e.g. How AI agents are changing software testing in 2026"
          onKeyDown={e => { if (e.key === 'Enter' && customTopic.trim() && !generatingCustom && !running) generateCustomTopic() }}
        />
        <button
          style={{ padding: '8px 18px', background: (!customTopic.trim() || generatingCustom || running) ? '#bbb' : '#0f3460', color: '#fff', border: 'none', borderRadius: '8px', cursor: (!customTopic.trim() || generatingCustom || running) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '600', opacity: (!customTopic.trim() || generatingCustom || running) ? 0.7 : 1 }}
          onClick={generateCustomTopic}
          disabled={!customTopic.trim() || generatingCustom || running}
        >
          {generatingCustom ? '⏳ Generating…' : '⚡ Generate Draft'}
        </button>
      </div>

      {loadingRuns ? (
        <div style={styles.emptyState}>Loading…</div>
      ) : runs.length === 0 ? (
        <div style={styles.emptyState}>No runs yet — click "Run Agent" to start</div>
      ) : (
        <div style={styles.runsList}>
          {runs.map(run => {
            const sc = STATUS_COLORS[run.status] || STATUS_COLORS.pending
            return (
              <div
                key={run._id}
                style={{ ...styles.runRow, ...(selectedRun?._id === run._id ? styles.runRowActive : {}), ...(hoveredId === run._id ? styles.runRowHover : {}) }}
                onClick={() => setSelectedRun(run)}
                onMouseEnter={() => setHoveredId(run._id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <span style={styles.runTopic}>{run.topic?.phrase || run.artifacts?.draftPath?.split('/').pop() || '—'}</span>
                <span style={{ ...styles.statusBadge, background: sc.bg, color: sc.color }}>{run.status}</span>
                <div style={styles.stepsRow}>{renderStepChips(run.steps)}</div>
                <span style={styles.runMeta}>{formatDate(run.createdAt)}</span>
              </div>
            )
          })}
        </div>
      )}

      {selectedRun && (
        <div style={styles.modal} onClick={() => { setPreviewOpen(false); setSelectedRun(null) }}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>{selectedRun.topic?.phrase || 'Blog Draft'}</div>
              <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {selectedRun.draft?.bodyMarkdown ? (
                  <button
                    type="button"
                    style={styles.previewBtn}
                    onClick={() => setPreviewOpen(true)}
                  >
                    Preview
                  </button>
                ) : null}
                <button style={styles.closeBtn} onClick={() => { setPreviewOpen(false); setSelectedRun(null) }}>×</button>
              </div>
            </div>

            <div style={styles.detailGrid}>
              <div>
                <div style={styles.detailLabel}>Status</div>
                <div style={{ ...styles.statusBadge, display: 'inline-block', ...STATUS_COLORS[selectedRun.status] }}>{selectedRun.status}</div>
              </div>
              <div>
                <div style={styles.detailLabel}>Country</div>
                <div style={styles.detailValue}>{selectedRun.countryCode || '—'}</div>
              </div>
              <div>
                <div style={styles.detailLabel}>Time Range</div>
                <div style={styles.detailValue}>{selectedRun.timeRange || timeRange}</div>
              </div>
              <div>
                <div style={styles.detailLabel}>SEO Title</div>
                <div style={styles.detailValue}>{selectedRun.draft?.seoTitle || '—'}</div>
              </div>
              <div>
                <div style={styles.detailLabel}>Word Count</div>
                <div style={styles.detailValue}>{selectedRun.draft ? (selectedRun.draft.bodyMarkdown?.split(/\s+/).length || selectedRun.steps?.draft?.wordEstimate || 0) : 0}</div>
              </div>
              {selectedRun.topic?.gapScore != null && (
                <div>
                  <div style={styles.detailLabel}>Gap Score</div>
                  <div style={styles.detailValue}>{selectedRun.topic.gapScore}/12</div>
                </div>
              )}
              {selectedRun.topic?.intent && (
                <div>
                  <div style={styles.detailLabel}>Intent</div>
                  <div style={styles.detailValue}>{selectedRun.topic.intent}</div>
                </div>
              )}
            </div>

            {selectedRun.draft?.heroImage && (
              <div style={{ marginTop: '16px' }}>
                <div style={styles.detailLabel}>Hero Image</div>
                <img
                  src={blogHeroUrl(selectedRun) || `/api/blog-pipeline/runs/${selectedRun._id}/images/hero`}
                  style={styles.heroImage}
                  alt="Hero"
                />
              </div>
            )}

            {selectedRun.draft?.metaDescription && (
              <div style={{ marginTop: '16px' }}>
                <div style={styles.detailLabel}>Meta Description</div>
                <div style={{ fontSize: '13px', color: '#555', lineHeight: '1.5' }}>{selectedRun.draft.metaDescription}</div>
              </div>
            )}

            {selectedRun.draft?.bodyMarkdown && (
              <div style={{ marginTop: '16px' }}>
                <div style={styles.detailLabel}>Body Markdown</div>
                <div style={styles.markdown}>{selectedRun.draft.bodyMarkdown}</div>
              </div>
            )}

            {selectedRun.error && (
              <div style={styles.errorBox}>Error: {selectedRun.error}</div>
            )}

            {selectedRun.logs && selectedRun.logs.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <div style={{ ...styles.detailLabel, marginBottom: '8px' }}>Pipeline Logs</div>
                <div style={{ ...styles.markdown, maxHeight: '300px', background: '#1a1a2e', color: '#a8d8a8', fontSize: '12px' }}>
                  {selectedRun.logs.map((line, i) => <div key={i} style={{ borderBottom: '1px solid #2a2a4a', padding: '2px 0' }}>{line}</div>)}
                </div>
              </div>
            )}

            <div style={styles.actionRow}>
              {selectedRun.status === 'completed' && (
                <>
                  <button style={styles.approveBtn} onClick={() => { approveRun(selectedRun._id); setSelectedRun(null); }}>✓ Approve</button>
                  <button style={styles.rejectBtn} onClick={() => { rejectRun(selectedRun._id); setSelectedRun(null); }}>✗ Reject</button>
                </>
              )}
              {selectedRun.status === 'approved' && (
                <button style={{ ...styles.approveBtn, background: '#0f3460' }} onClick={() => { const id = selectedRun._id; postRun(id); setSelectedRun(null); }}>↑ Post to Site</button>
              )}
              <button style={styles.deleteBtn} onClick={() => { deleteRun(selectedRun._id); setSelectedRun(null); }}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && selectedRun?.draft?.bodyMarkdown && (
        <div style={styles.previewOverlay}>
          <div style={styles.previewToolbar}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Blog preview</span>
            <button
              type="button"
              style={{ ...styles.closeBtn, fontSize: '28px' }}
              onClick={() => setPreviewOpen(false)}
              aria-label="Close preview"
            >
              ×
            </button>
          </div>
          <div style={styles.previewScroll}>
            <BlogArticlePreview run={selectedRun} />
          </div>
        </div>
      )}

      {suggestOpen && (
        <div style={styles.suggestModal} onClick={() => setSuggestOpen(false)}>
          <div style={styles.suggestContent} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={styles.suggestTitle}>💡 Topic Suggestions</div>
                <div style={styles.suggestSubtitle}>Click a topic to select it, then Generate Draft</div>
              </div>
              <button style={styles.closeBtn} onClick={() => setSuggestOpen(false)}>×</button>
            </div>

            {suggestLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                <div style={styles.spinner} /> Analyzing topics…
              </div>
            ) : suggestCandidates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>No topic suggestions found.</div>
            ) : (
              suggestCandidates.map((c, i) => {
                const computedGrade = c.gapScore >= 8 ? 'EXCEPTIONAL' : c.gapScore >= 6 ? 'STRONG' : c.gapScore >= 4 ? 'MEDIUM' : 'WEAK'
                const gradeColors = { EXCEPTIONAL: { bg: '#e8f5e9', color: '#27ae60' }, STRONG: { bg: '#e3f0ff', color: '#0f3460' }, MEDIUM: { bg: '#fff3e0', color: '#e67e22' }, WEAK: { bg: '#fee', color: '#e74c3c' } }
                const gc = gradeColors[computedGrade] || gradeColors.WEAK
                return (
                  <div
                    key={i}
                    style={{ ...styles.topicCard, ...(selectedTopic?.phrase === c.phrase ? styles.topicCardActive : {}) }}
                    onClick={() => setSelectedTopic(c)}
                  >
                    <div style={styles.topicPhrase}>
                      {c.phrase}
                      {recommendedPhrase === c.phrase && (
                        <span style={{ ...styles.topicBadge, background: '#e3f0ff', color: '#0f3460', marginLeft: '8px' }}>Recommended</span>
                      )}
                    </div>
                    <div style={styles.topicMeta}>
                      <span style={{ ...styles.topicBadge, background: gc.bg, color: gc.color }}>{computedGrade}</span>
                      <span style={{ ...styles.topicBadge, background: '#f0f0f0', color: '#555' }}>gap {c.gapScore}/12</span>
                      <span style={{ ...styles.topicBadge, background: '#f0f0f0', color: '#555' }}>intent: {c.intent}</span>
                      <span style={{ ...styles.topicBadge, background: '#f0f0f0', color: '#555' }}>recent: {c.recentOrganicCount || 0}</span>
                      <span style={{ ...styles.topicBadge, background: '#f0f0f0', color: '#555' }}>related: {c.relatedRichness || 0}</span>
                    </div>
                  </div>
                )
              })
            )}

            <div style={styles.suggestActions}>
              <button style={styles.cancelBtn} onClick={() => setSuggestOpen(false)}>Cancel</button>
              <button style={styles.generateBtn} onClick={startRunWithTopic} disabled={!selectedTopic || running}>
                {running ? '⏳ Running…' : '⚡ Generate Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}