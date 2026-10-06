import React, { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import apiClient, { SCRAPE_API_TIMEOUT_MS } from '../../api/client'

const STATUS_COLORS = {
  new:       { bg: '#ebf8ff', color: '#2b6cb0', border: '#bee3f8' },
  applied:   { bg: '#f0fff4', color: '#276749', border: '#9ae6b4' },
  interview: { bg: '#fffaf0', color: '#c05621', border: '#feebc8' },
  offer:     { bg: '#f0fff4', color: '#22543d', border: '#68d391' },
  rejected:  { bg: '#fff5f5', color: '#c53030', border: '#feb2b2' },
  archived:  { bg: '#f7fafc', color: '#718096', border: '#e2e8f0' }
}
const STATUS_OPTIONS = ['new', 'applied', 'interview', 'offer', 'rejected', 'archived']

// Deduplicate candidate dropdown options by normalized name so the same person
// (e.g., two ingested resumes for "Muhammad Aqib") never appears twice. Callers
// sort by score FIRST, so keeping the first occurrence per name preserves the
// highest-scored duplicate for that candidate.
function dedupeCandidatesForDropdown(candidates) {
  const seen = new Set()
  const out = []
  for (const c of candidates || []) {
    const name = String(c?.name || '').trim().toLowerCase().replace(/\s+/g, ' ')
    const key = name ? `name:${name}` : `id:${String(c?._id)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

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

function UpworkJobCard({ job, onSelect, onStatusChange, onDelete, brandId }) {
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(job.userNotes || '')
  const [savingNotes, setSavingNotes] = useState(false)

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await apiClient.put(`/brands/${brandId}/apify/jobs/upwork/${job._id}`, { userNotes: notes })
      setEditingNotes(false)
    } catch {}
    setSavingNotes(false)
  }

  function formatDate(str) {
    if (!str) return ''
    const d = new Date(str)
    if (isNaN(d)) return str
    const now = new Date()
    const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24))
    if (diff < 0) return str
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Yesterday'
    if (diff < 7) return `${diff}d ago`
    if (diff < 30) return `${Math.floor(diff / 7)}w ago`
    return d.toLocaleDateString()
  }

  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '18px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '1px solid #eee', marginBottom: '16px' }}>
      <div
        style={{ cursor: 'pointer' }}
        onClick={() => onSelect(job)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a2e', lineHeight: '1.3', flex: 1, marginRight: '8px' }}>{job.title}</div>
          {job.url && <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '20px', fontWeight: '600', whiteSpace: 'nowrap', background: '#14a800', color: '#fff' }}>Apply</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <span style={{ fontSize: '13px', color: '#444', fontWeight: '500' }}>{job.clientName || 'Unknown Client'}</span>
          {job.paymentVerified
            ? <span style={{ fontSize: '10px', background: '#e8f5e9', color: '#28a745', padding: '2px 6px', borderRadius: '20px', fontWeight: '600' }}>✓ Verified</span>
            : <span style={{ fontSize: '10px', background: '#f1f3f4', color: '#999', padding: '2px 6px', borderRadius: '20px' }}>Unverified</span>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
          {job.trackerStatus && <StatusBadge status={job.trackerStatus} />}
          {job.jobStatus && <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: job.jobStatus === 'open' ? '#e8f5e9' : '#f1f3f4', color: job.jobStatus === 'open' ? '#2e7d32' : '#718096', fontWeight: '500' }}>● {job.jobStatus}</span>}
          {job.jobType && <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#f0f4ff', color: '#3b5bdb', fontWeight: '500' }}>{job.jobType}</span>}
          {job.experienceLevel && <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#f1f3f4', color: '#666', fontWeight: '500' }}>{job.experienceLevel}</span>}
          {job.clientRating != null && <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#f1f3f4', color: '#666', fontWeight: '500' }}>★ {job.clientRating}</span>}
          {job.proposals != null && <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#f1f3f4', color: '#666', fontWeight: '500' }}>{job.proposals} proposals</span>}
        </div>
        {job.skills?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
            {job.skills.slice(0, 5).map((s, i) => <span key={i} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#f0f4ff', color: '#3b5bdb', fontWeight: '500' }}>{s}</span>)}
            {job.skills.length > 5 && <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#f1f3f4', color: '#666', fontWeight: '500' }}>+{job.skills.length - 5}</span>}
          </div>
        )}
        {job.budget && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#1a1a2e' }}>{job.budget}</span>
            {job.clientAvgHourlyRate && <span style={{ fontSize: '12px', color: '#666' }}>Avg ${job.clientAvgHourlyRate}/hr</span>}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #f5f5f5' }}>
          <span style={{ fontSize: '11px', color: '#999' }}>{formatDate(job.absoluteDate) || job.relativeDate}</span>
          {job.clientLocation && <span style={{ fontSize: '11px', color: '#888' }}>{job.clientLocation}</span>}
        </div>
      </div>
      {/* Action row */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', borderTop: '1px solid #f5f5f5', marginTop: '10px', paddingTop: '10px' }}>
        <select value={job.trackerStatus || 'new'} onChange={e => { e.stopPropagation(); onStatusChange(job._id, e.target.value) }}
          onClick={e => e.stopPropagation()}
          style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', background: '#fff' }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={(e) => { e.stopPropagation(); setEditingNotes(v => !v) }}
          style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', padding: '5px 10px', color: '#4a5568' }}>
          {editingNotes ? 'Cancel' : 'Notes'}
        </button>
        {onDelete && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(job._id) }}
            style={{ background: 'none', border: '1px solid #feb2b2', borderRadius: '6px', cursor: 'pointer', color: '#c53030', fontSize: '12px', padding: '5px 10px', marginLeft: 'auto' }}>
            Delete
          </button>
        )}
      </div>
      {/* Notes editor */}
      {editingNotes && (
        <div style={{ marginTop: '10px', borderTop: '1px solid #f0f0f0', paddingTop: '10px' }}>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Add your notes about this job..."
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          <button onClick={(e) => { e.stopPropagation(); saveNotes() }} disabled={savingNotes}
            style={{ marginTop: '6px', padding: '5px 12px', background: '#276749', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
            {savingNotes ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      )}
    </div>
  )
}

const styles = {
  page: { padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif' },
  header: { marginBottom: '24px' },
  title: { fontSize: '22px', fontWeight: '700', color: '#1a1a2e', marginBottom: '4px' },
  subtitle: { fontSize: '13px', color: '#888', marginBottom: '0' },
  searchRow: { display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' },
  searchInput: { padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '13px', flex: 1, minWidth: '200px', maxWidth: '400px' },
  filterBtn: { padding: '8px 14px', borderRadius: '8px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: '13px', color: '#555' },
  filterBtnActive: { background: '#e8f5e9', border: '1px solid #28a745', color: '#28a745' },
  totalBadge: { fontSize: '12px', color: '#666', background: '#f0f0f0', padding: '4px 10px', borderRadius: '20px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' },
  card: {
    background: '#fff', borderRadius: '12px', padding: '18px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)', cursor: 'pointer',
    transition: 'box-shadow 0.15s, transform 0.15s', border: '1px solid #eee'
  },
  cardHover: { boxShadow: '0 4px 16px rgba(0,0,0,0.14)', transform: 'translateY(-1px)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' },
  jobTitle: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', lineHeight: '1.3', flex: 1, marginRight: '8px' },
  applyBadge: { fontSize: '10px', padding: '3px 8px', borderRadius: '20px', fontWeight: '600', whiteSpace: 'nowrap' },
  clientRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' },
  clientName: { fontSize: '13px', color: '#444', fontWeight: '500' },
  verifiedBadge: { fontSize: '10px', background: '#e8f5e9', color: '#28a745', padding: '2px 6px', borderRadius: '20px', fontWeight: '600' },
  unverifiedBadge: { fontSize: '10px', background: '#f1f3f4', color: '#999', padding: '2px 6px', borderRadius: '20px' },
  metaRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' },
  tag: { fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#f0f4ff', color: '#3b5bdb', fontWeight: '500' },
  tagGreen: { fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#e8f5e9', color: '#2e7d32', fontWeight: '500' },
  tagOrange: { fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#fff3e0', color: '#e65100', fontWeight: '500' },
  tagGray: { fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#f1f3f4', color: '#666', fontWeight: '500' },
  budgetRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  budget: { fontSize: '14px', fontWeight: '700', color: '#1a1a2e' },
  hourlyRate: { fontSize: '12px', color: '#666' },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #f5f5f5' },
  date: { fontSize: '11px', color: '#999' },
  proposals: { fontSize: '11px', color: '#999' },
  emptyState: { textAlign: 'center', padding: '60px 20px', color: '#999', fontSize: '14px' },
  skeleton: { height: '180px', borderRadius: '12px', background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '24px' },
  pageBtn: { padding: '6px 14px', borderRadius: '8px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: '13px' },
  pageBtnActive: { background: '#0f3460', color: '#fff', border: '1px solid #0f3460' },
  pageInfo: { fontSize: '12px', color: '#888', padding: '0 8px' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' },
  scrapeBtn: { padding: '10px 18px', background: '#14a800', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap' },
  scrapeBtnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  scrapeBanner: { padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' },
  scrapeBannerInfo: { background: '#fffbeb', border: '1px solid #f6e05e', color: '#744210' },
  scrapeBannerOk: { background: '#f0fff4', border: '1px solid #9ae6b4', color: '#276749' },
  scrapeBannerErr: { background: '#fff5f5', border: '1px solid #feb2b2', color: '#c53030' },
  modal: {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    box: { background: '#fff', borderRadius: '16px', padding: '28px', width: '680px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
  }
}

function JobDetailModal({ job, onClose, onJobUpdated }) {
  const [coverLetter, setCoverLetter] = useState(job?.coverLetter || '')
  const [coverLetterUpdatedAt, setCoverLetterUpdatedAt] = useState(job?.coverLetterUpdatedAt || null)
  const [editingLetter, setEditingLetter] = useState(false)
  const [generatingLetter, setGeneratingLetter] = useState(false)
  const [savingLetter, setSavingLetter] = useState(false)
  const [letterError, setLetterError] = useState('')
  const [allCandidates, setAllCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  // Profile approval & save state machine. stagedProfileId is the dropdown's
  // working value; it only reaches the server once the user clicks Approve ->
  // Save Profile Selection. isSaved stays false until that persists, which
  // keeps the cover letter generator locked until an explicit save.
  const [stagedProfileId, setStagedProfileId] = useState(job?.selectedProfileId || job?.aiRecommendedProfileId || '')
  const [isApproved, setIsApproved] = useState(false)
  const [isSaved, setIsSaved] = useState(Boolean(job?.selectedProfileId) && job?.selectionSource !== 'AI_RECOMMENDED')
  const [isEditing, setIsEditing] = useState(!(Boolean(job?.selectedProfileId) && job?.selectionSource !== 'AI_RECOMMENDED'))
  const [savingProfile, setSavingProfile] = useState(false)
  const [scoringJob, setScoringJob] = useState(false)

  const brandId = window.location.pathname.match(/\/brands\/([^/]+)/)?.[1]
  const jobId = job?._id

  useEffect(() => {
    if (!job) return
    setStagedProfileId(job.selectedProfileId || job.aiRecommendedProfileId || '')
    setIsApproved(false)
    setIsSaved(Boolean(job.selectedProfileId) && job.selectionSource !== 'AI_RECOMMENDED')
    setIsEditing(!(Boolean(job.selectedProfileId) && job.selectionSource !== 'AI_RECOMMENDED'))
    setCandidatesLoading(true)
    let cancelled = false
    // Fetch ALL candidate profiles from the DB whenever the modal opens so the
    // dropdown always lists every candidate — never rely only on prior scores.
    apiClient.get('/candidate-profiles')
      .then(res => { if (!cancelled) setAllCandidates(res.data.profiles || []) })
      .catch(err => console.error('Failed to load candidate profiles:', err))
      .finally(() => { if (!cancelled) setCandidatesLoading(false) })
    return () => { cancelled = true }
  }, [job?._id])

  if (!job) return null

  const applyJobUpdate = (updates) => {
    if (onJobUpdated) onJobUpdated(jobId, updates)
  }

  // Score lookup map for the current job's AI evaluations.
  const scoresByProfile = {}
  ;(job.profileMatchScores || []).forEach(m => { if (m && m.profileId) scoresByProfile[String(m.profileId)] = m })
  const aiRecId = job.aiRecommendedProfileId
  const aiRecMatch = aiRecId ? scoresByProfile[String(aiRecId)] : null
  const aiRecName = aiRecMatch?.profileName || allCandidates.find(p => String(p._id) === String(aiRecId))?.name || null
  const aiRecScore = aiRecMatch?.score ?? job.aiRecommendedScore ?? null
  const hasBeenScored = Boolean(job.profileMatchScores?.length) || job.aiRecommendedProfileId != null || job.aiRecommendedScore != null

  // Every candidate in MongoDB is the single source of truth for the dropdown.
  // Score labels are looked up from job.profileMatchScores per candidate.
  const effectiveProfileId = stagedProfileId || job.selectedProfileId || job.aiRecommendedProfileId || ''
  const isProfileSelected = Boolean(stagedProfileId || job.selectedProfileId || job.aiRecommendedProfileId)

  // Changing the dropdown only stages the pick locally. It is NOT persisted
  // until the user clicks [ Approve ] then [ Save Profile Selection ].
  const handleProfileChange = (e) => {
    const nextId = e.target.value
    setStagedProfileId(nextId)
    setIsApproved(false)
    setIsSaved(false)
    console.log('[PROFILE STAGED] Job:', jobId, 'Staged Profile:', nextId)
  }

  const handleApprove = () => {
    if (!stagedProfileId) return
    setIsApproved(true)
    setIsEditing(false)
    setLetterError('')
  }

  const handleEditProfile = () => {
    setIsEditing(true)
    setIsApproved(false)
    setIsSaved(false)
    setLetterError('')
  }

  const handleSaveProfile = async () => {
    if (!stagedProfileId) return
    setSavingProfile(true)
    setLetterError('')
    try {
      const res = await apiClient.patch(`/brands/${brandId}/apify/jobs/upwork/${jobId}/select-profile`, { selectedProfileId: stagedProfileId })
      console.log('[PROFILE OVERRIDE] Job:', jobId, 'Switched to Profile:', stagedProfileId)
      applyJobUpdate({ selectedProfileId: res.data.selectedProfileId, selectionSource: res.data.selectionSource })
      setIsSaved(true)
      setIsApproved(false)
      setIsEditing(false)
    } catch (err) {
      setLetterError(err.response?.data?.error || err.message || 'Failed to save profile selection')
      return
    } finally {
      setSavingProfile(false)
    }
    // Auto-generate the cover letter for the freshly saved candidate so the
    // user never needs a second click. Guarded by !coverLetter so an existing
    // letter is never silently overwritten (Regenerate covers that case).
    if (!coverLetter) await handleGenerate()
  }

  const handleRunScoring = async () => {
    setScoringJob(true)
    setLetterError('')
    try {
      const res = await apiClient.post(`/brands/${brandId}/apify/jobs/upwork/${jobId}/score`, {})
      const top = res.data.top
      applyJobUpdate({
        aiRecommendedProfileId: top?.profileId,
        aiRecommendedScore: top?.score,
        profileMatchScores: res.data.scores,
        profileSelectionReasoning: top?.reasoning
      })
      if (top && !isSaved) {
        // Stage the fresh AI recommendation. It must be approved and saved
        // before the cover letter generator unlocks.
        setStagedProfileId(top.profileId)
        setIsApproved(false)
        setIsSaved(false)
        setIsEditing(true)
      }
    } catch (err) {
      setLetterError(err.response?.data?.error || err.message || 'Profile scoring failed')
    } finally {
      setScoringJob(false)
    }
  }

  const handleGenerate = async () => {
    setGeneratingLetter(true)
    setLetterError('')
    try {
      const res = await apiClient.post(`/brands/${brandId}/apify/jobs/upwork/${jobId}/cover-letter/generate`, {})
      setCoverLetter(res.data.coverLetter)
      setCoverLetterUpdatedAt(res.data.updatedAt || new Date().toISOString())
      setEditingLetter(false)
      applyJobUpdate({ coverLetter: res.data.coverLetter, coverLetterUpdatedAt: res.data.updatedAt })
    } catch (err) {
      setLetterError(err.response?.data?.error || err.message || 'Generation failed')
    } finally {
      setGeneratingLetter(false)
    }
  }

  const handleSave = async () => {
    setSavingLetter(true)
    setLetterError('')
    try {
      const res = await apiClient.put(`/brands/${brandId}/apify/jobs/upwork/${jobId}`, { coverLetter })
      const updated = res.data
      setCoverLetter(updated.coverLetter)
      setCoverLetterUpdatedAt(updated.coverLetterUpdatedAt || new Date().toISOString())
      setEditingLetter(false)
      applyJobUpdate({ coverLetter: updated.coverLetter, coverLetterUpdatedAt: updated.coverLetterUpdatedAt })
    } catch (err) {
      setLetterError(err.response?.data?.error || err.message || 'Save failed')
    } finally {
      setSavingLetter(false)
    }
  }

  const handleRegenerate = async () => {
    if (!window.confirm('Regenerating will replace your current cover letter. Continue?')) return
    await handleGenerate()
  }

  const formatUpdated = (d) => {
    if (!d) return ''
    try { return new Date(d).toLocaleString() } catch { return '' }
  }

  return (
    <div style={styles.modal.overlay} onClick={onClose}>
      <div style={styles.modal.box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1a1a2e', marginBottom: '6px', lineHeight: '1.3' }}>{job.title}</h2>
            <div style={{ fontSize: '14px', color: '#555', marginBottom: '6px' }}>Client: {job.clientName || 'Unknown'}</div>
            {job.url && (
              <a href={job.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#6eb5ff' }}>
                View on Upwork →
              </a>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#999', padding: '0 0 0 12px' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {job.paymentVerified && <span style={{ ...styles.tagGreen }}>✓ Payment Verified</span>}
          {!job.paymentVerified && <span style={{ ...styles.tagGray }}>Payment Unverified</span>}
          {job.jobType && <span style={{ ...styles.tag }}>{job.jobType}</span>}
          {job.experienceLevel && <span style={{ ...styles.tagGray }}>{job.experienceLevel}</span>}
          {job.budget && <span style={{ ...styles.tag, background: '#fff3e0', color: '#e65100' }}>{job.budget}</span>}
          {job.clientAvgHourlyRate && <span style={{ ...styles.tagGray }}>Avg rate: ${job.clientAvgHourlyRate}/hr</span>}
          {job.jobStatus && <span style={{ ...styles.tag, background: job.jobStatus === 'open' ? '#e8f5e9' : '#f1f3f4', color: job.jobStatus === 'open' ? '#2e7d32' : '#718096' }}>● {job.jobStatus}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px', fontSize: '13px' }}>
          {job.clientRating != null && <div><span style={{ color: '#888' }}>Rating: </span>{job.clientRating} / 5</div>}
          {job.clientTotalSpent != null && <div><span style={{ color: '#888' }}>Total Spent: </span>${job.clientTotalSpent.toLocaleString()}</div>}
          {job.clientHireRatePercent != null && <div><span style={{ color: '#888' }}>Hire Rate: </span>{job.clientHireRatePercent}%</div>}
          {job.clientLocation && <div><span style={{ color: '#888' }}>Location: </span>{job.clientLocation}</div>}
          {job.relativeDate && <div><span style={{ color: '#888' }}>Posted: </span>{job.relativeDate}</div>}
          {job.absoluteDate && <div><span style={{ color: '#888' }}>Date: </span>{job.absoluteDate}</div>}
          {job.proposals != null && <div><span style={{ color: '#888' }}>Proposals: </span>{job.proposals}</div>}
          {job.hasHired && <div><span style={{ color: '#888' }}>Has hired before: </span>Yes</div>}
        </div>

        {job.description && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</div>
            <div style={{ fontSize: '13px', color: '#444', lineHeight: '1.6', whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto', backgroundColor: '#f9fafb', padding: '12px', borderRadius: '8px' }}>
              {job.description}
            </div>
          </div>
        )}

        {job.tags?.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Skills</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {job.tags.map((tag, i) => <span key={i} style={{ ...styles.tagGray }}>{tag}</span>)}
            </div>
          </div>
        )}

        {job.allowedApplicantCountries?.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Allowed Countries</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {job.allowedApplicantCountries.map((c, i) => <span key={i} style={{ ...styles.tagGray }}>{c}</span>)}
            </div>
          </div>
        )}

        {job.skills?.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Required Skills</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {job.skills.map((s, i) => <span key={i} style={{ ...styles.tag }}>{s}</span>)}
            </div>
          </div>
        )}

        {/* AI Recommended Profile section */}
        <div style={{ marginBottom: '16px', border: '1px solid #d6e4ff', borderRadius: '10px', padding: '14px', background: '#f7faff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#1a3a8f', textTransform: 'uppercase', letterSpacing: '0.5px' }}>AI Recommended Profile</div>
            {job.selectionSource === 'MANUAL_OVERRIDE' && (
              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: '#fff3e0', color: '#e65100', fontWeight: 600 }}>Manual Override</span>
            )}
          </div>

          {aiRecName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a2e' }}>🤖 {aiRecName}</span>
              {aiRecScore != null && (
                <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '20px', background: '#e8f5e9', color: '#2e7d32', fontWeight: 700 }}>{Math.round(aiRecScore)}%</span>
              )}
              {!aiRecName && job.aiRecommendedScore != null && (
                <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '20px', background: '#e8f5e9', color: '#2e7d32', fontWeight: 700 }}>{Math.round(job.aiRecommendedScore)}%</span>
              )}
            </div>
          )}

          {/* Approve / Edit action buttons — next to the recommendation */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={handleApprove}
              disabled={!stagedProfileId || !isEditing || isApproved}
              style={{
                padding: '6px 14px', borderRadius: '6px', border: '1px solid',
                borderColor: isApproved ? '#28a745' : '#e2e8f0',
                background: isApproved ? '#e8f5e9' : '#fff',
                color: isApproved ? '#276749' : '#4a5568',
                cursor: (!stagedProfileId || !isEditing || isApproved) ? 'not-allowed' : 'pointer',
                fontSize: '12px', fontWeight: 600
              }}
            >
              {isApproved ? '✓ Approved' : 'Approve'}
            </button>
            <button
              onClick={handleEditProfile}
              style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', color: '#4a5568', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
            >
              Edit
            </button>
            {isSaved && (
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#e8f5e9', color: '#276749', fontWeight: 600 }}>Saved</span>
            )}
            {isApproved && !isSaved && (
              <span style={{ fontSize: '11px', color: '#2b6cb0', fontWeight: 600 }}>Approved — click Save Profile Selection to persist</span>
            )}
          </div>

          <div style={{ fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>Select candidate profile for this job:</div>
          <select
            value={String(effectiveProfileId)}
            onChange={handleProfileChange}
            disabled={!isEditing || candidatesLoading}
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '13px', background: isEditing ? '#fff' : '#f7fafc', color: isEditing ? '#1a1a2e' : '#718096' }}
          >
            <option value="">{candidatesLoading ? 'Loading candidates...' : 'Select a candidate profile...'}</option>
            {dedupeCandidatesForDropdown(
              [...allCandidates].sort((a, b) => {
                const scoreA = job.profileMatchScores?.find(s => String(s.profileId) === String(a._id))?.score ?? -1
                const scoreB = job.profileMatchScores?.find(s => String(s.profileId) === String(b._id))?.score ?? -1
                return scoreB - scoreA
              })
            ).map(candidate => {
                const match = job.profileMatchScores?.find(s => String(s.profileId) === String(candidate._id))
                const scoreLabel = match ? `${Math.round(match.score)}%` : 'Not Scored'
                return (
                  <option key={String(candidate._id)} value={String(candidate._id)}>
                    {candidate.name || candidate._id} — {scoreLabel}
                  </option>
                )
              })}
          </select>

          {effectiveProfileId && (scoresByProfile[String(effectiveProfileId)]?.reasoning || job.profileSelectionReasoning) && (
            <details style={{ marginTop: '8px' }}>
              <summary style={{ fontSize: '12px', fontWeight: 600, color: '#2b6cb0', cursor: 'pointer' }}>Why this profile?</summary>
              <div style={{ fontSize: '12px', color: '#555', lineHeight: '1.5', marginTop: '6px', whiteSpace: 'pre-wrap' }}>
                {scoresByProfile[String(effectiveProfileId)]?.reasoning || job.profileSelectionReasoning}
              </div>
            </details>
          )}

          {/* Bottom row: Run AI Scoring (left) + Save Profile Selection (bottom-right) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            <button onClick={handleRunScoring} disabled={scoringJob}
              style={{ padding: '6px 12px', background: '#0f3460', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              {scoringJob ? 'Scoring...' : hasBeenScored ? 'Re-run AI Scoring' : 'Run AI Scoring'}
            </button>
            <button
              onClick={handleSaveProfile}
              disabled={!isApproved || savingProfile}
              style={{
                padding: '7px 14px', borderRadius: '6px', border: 'none',
                background: isApproved ? '#28a745' : '#e2e8f0',
                color: isApproved ? '#fff' : '#a0aec0',
                cursor: (!isApproved || savingProfile) ? 'not-allowed' : 'pointer',
                fontSize: '12px', fontWeight: 700
              }}
            >
              {savingProfile ? 'Saving...' : 'Save Profile Selection'}
            </button>
          </div>

          {!isSaved && effectiveProfileId && (
            <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
              Approve, then click Save Profile Selection — the cover letter is generated automatically.
            </div>
          )}
        </div>

        <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a2e' }}>AI Cover Letter</div>
            {coverLetter && !editingLetter && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleRegenerate} disabled={!isSaved || generatingLetter} style={{ padding: '6px 12px', background: '#f1f3f4', color: '#4a5568', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: !isSaved ? 'not-allowed' : 'pointer', opacity: !isSaved ? 0.5 : 1, fontSize: '12px' }}>
                  {generatingLetter ? '⏳ Generating...' : 'Regenerate'}
                </button>
                <button onClick={() => setEditingLetter(true)} style={{ padding: '6px 12px', background: '#f1f3f4', color: '#4a5568', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Edit</button>
              </div>
            )}
          </div>

          {!coverLetter && !editingLetter && (
            <div>
              {generatingLetter ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', background: '#f0f7ff', borderRadius: '8px', fontSize: '13px', color: '#2b6cb0', fontWeight: 600 }}>
                  ⏳ Generating cover letter for the saved profile...
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.4' }}>No cover letter yet. Saving a profile selection above automatically generates an AI-drafted cover letter tailored to this job.</div>
                  {!isSaved && (
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                      {isProfileSelected
                        ? 'Approve, then click Save Profile Selection — the cover letter is generated automatically.'
                        : 'Select a candidate profile above (run AI Scoring or pick one), then save the selection to generate a cover letter automatically.'}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {letterError && <div style={{ fontSize: '12px', color: '#c53030', marginTop: '8px' }}>{letterError}</div>}

          {(coverLetter || editingLetter) && (
            <div>
              <textarea
                value={coverLetter}
                onChange={e => setCoverLetter(e.target.value)}
                rows={10}
                placeholder="Your AI-generated cover letter will appear here..."
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
              {editingLetter && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={handleSave} disabled={savingLetter} style={{ padding: '8px 16px', background: '#276749', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    {savingLetter ? 'Saving...' : 'Save Cover Letter'}
                  </button>
                  <button onClick={() => { setEditingLetter(false); setCoverLetter(job.coverLetter || '') }} style={{ padding: '8px 16px', background: '#f1f3f4', color: '#4a5568', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                </div>
              )}
              {coverLetterUpdatedAt && (
                <div style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>Last updated: {formatUpdated(coverLetterUpdatedAt)}</div>
              )}
            </div>
          )}
        </div>

        {job.url && (
          <a href={job.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '10px 20px', background: '#14a800', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}>
            Apply on Upwork →
          </a>
        )}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return <div style={{ ...styles.skeleton }} />
}

export default function UpworkScraper() {
  const { brandId } = useParams()
  const location = useLocation()
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [search, setSearch] = useState('')
  const [paymentVerified, setPaymentVerified] = useState(false)
  const [trackerFilter, setTrackerFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [scraping, setScraping] = useState(false)
  const [scrapeMessage, setScrapeMessage] = useState('')
  const [scrapeError, setScrapeError] = useState('')
  const [selectedJob, setSelectedJob] = useState(null)
  const limit = 18

  const fetchJobs = async (pageNum = 1, searchTerm = search, pv = paymentVerified) => {
    const urlBrandId = window.location.pathname.match(/\/brands\/([^/]+)/)?.[1]
    if (!urlBrandId) return
    setLoading(true)
    try {
      const res = await apiClient.get(`/brands/${urlBrandId}/apify/jobs/upwork`, {
        params: { page: pageNum, limit, search: searchTerm, paymentVerified: pv ? 'true' : '', trackerStatus: trackerFilter !== 'all' ? trackerFilter : '' }
      })
      setJobs(res.data.jobs)
      setTotal(res.data.total)
      setPages(res.data.pages)
      setPage(res.data.page)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Force fresh fetch on every navigation to this scraper type
  useEffect(() => {
    if (!brandId) return
    setJobs([])
    setTotal(0)
    setPage(1)
    setSearch('')
    fetchJobs()
  }, [location.pathname, brandId, trackerFilter])

  const handleSearch = (e) => {
    e.preventDefault()
    fetchJobs(1, search, paymentVerified)
  }

  const togglePv = () => {
    const next = !paymentVerified
    setPaymentVerified(next)
    fetchJobs(1, search, next)
  }

  const handleScrapeJobs = async () => {
    const urlBrandId = window.location.pathname.match(/\/brands\/([^/]+)/)?.[1]
    if (!urlBrandId) return
    if (!window.confirm('Run Upwork job scraper using this brand\'s saved Apify settings? Jobs will be saved to the database (no HR email lookup).')) return

    setScraping(true)
    setScrapeMessage('')
    setScrapeError('')
    try {
      const res = await apiClient.post(
        `/brands/${urlBrandId}/apify/scrape-jobs/upwork`,
        {},
        { timeout: SCRAPE_API_TIMEOUT_MS }
      )
      const msg = res.data.message
        || (res.data.dropped > 0
          ? `Stored ${res.data.stored} job(s). Skipped ${res.data.dropped} outside allowed locations.`
          : res.data.apifyReturned > res.data.stored
            ? `Apify returned ${res.data.apifyReturned} jobs; stored ${res.data.stored}.`
            : `Stored ${res.data.stored} job(s).`)
      setScrapeMessage(msg)
      await fetchJobs(1, search, paymentVerified)
    } catch (err) {
      setScrapeError(err.response?.data?.error || err.message || 'Scrape failed')
    } finally {
      setScraping(false)
    }
  }

  const handleStatusChange = async (jobId, newStatus) => {
    const urlBrandId = window.location.pathname.match(/\/brands\/([^/]+)/)?.[1]
    if (!urlBrandId) return
    try {
      await apiClient.put(`/brands/${urlBrandId}/apify/jobs/upwork/${jobId}`, {
        trackerStatus: newStatus,
        rejectedAt: newStatus === 'rejected' ? new Date().toISOString() : undefined,
        appliedAt: newStatus === 'applied' ? new Date().toISOString() : undefined
      })
      await fetchJobs(page, search, paymentVerified)
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  const handleDeleteJob = async (jobId) => {
    const urlBrandId = window.location.pathname.match(/\/brands\/([^/]+)/)?.[1]
    if (!urlBrandId) return
    if (!confirm('Delete this job?')) return
    try {
      await apiClient.delete(`/brands/${urlBrandId}/apify/jobs/upwork/${jobId}`)
      setJobs(prev => prev.filter(j => j._id !== jobId))
      setTotal(prev => Math.max(0, prev - 1))
    } catch (err) {
      console.error('Failed to delete job:', err)
    }
  }

  const handleJobUpdated = (jobId, updates) => {
    setSelectedJob(prev => prev && prev._id === jobId ? { ...prev, ...updates } : prev)
    setJobs(prev => prev.map(j => j._id === jobId ? { ...j, ...updates } : j))
  }

  const formatDate = (str) => {
    if (!str) return ''
    const d = new Date(str)
    if (isNaN(d)) return str
    const now = new Date()
    const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24))
    if (diff < 0) return str
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Yesterday'
    if (diff < 7) return `${diff}d ago`
    if (diff < 30) return `${Math.floor(diff / 7)}w ago`
    return d.toLocaleDateString()
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div style={styles.header}>
          <div style={styles.title}>Upwork Job Scraper</div>
          <p style={styles.subtitle}>Fetch jobs from Apify and browse stored listings — no contact enrichment</p>
        </div>
        <button
          type="button"
          onClick={handleScrapeJobs}
          disabled={scraping}
          style={{ ...styles.scrapeBtn, ...(scraping ? styles.scrapeBtnDisabled : {}) }}
        >
          {scraping ? '⏳ Scraping...' : '+ Scrape Jobs'}
        </button>
      </div>

      {scraping && (
        <div style={{ ...styles.scrapeBanner, ...styles.scrapeBannerInfo }}>
          Scraping Upwork jobs — this can take a few minutes. Do not close this page.
        </div>
      )}
      {!scraping && scrapeMessage && (
        <div style={{ ...styles.scrapeBanner, ...styles.scrapeBannerOk }}>{scrapeMessage}</div>
      )}
      {!scraping && scrapeError && (
        <div style={{ ...styles.scrapeBanner, ...styles.scrapeBannerErr }}>{scrapeError}</div>
      )}

      {/* Status tracker tabs — above search */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {['all', ...STATUS_OPTIONS].map(s => (
          <button
            key={s}
            onClick={() => { setTrackerFilter(s); setPage(1) }}
            style={{
              padding: '6px 12px', borderRadius: '8px', border: '1px solid',
              borderColor: trackerFilter === s ? '#14a800' : '#e2e8f0',
              background: trackerFilter === s ? '#f0fff4' : '#fff',
              color: trackerFilter === s ? '#276749' : '#718096',
              fontSize: '12px', fontWeight: trackerFilter === s ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            {s === 'all' ? 'All (' + total + ')' : s}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by job title or client name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, padding: '9px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' }}
        />
        <button type="submit" style={{ padding: '9px 16px', background: '#14a800', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>Search</button>
        {search && <button type="button" onClick={() => { setSearch(''); fetchJobs(1, '', paymentVerified) }} style={{ padding: '8px 12px', background: '#f1f3f4', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#666' }}>Clear</button>}
        <button type="button" onClick={togglePv} style={{ ...styles.filterBtn, ...(paymentVerified ? styles.filterBtnActive : {}) }}>
          {paymentVerified ? '✓ Payment Verified' : 'Payment Verified'}
        </button>
      </form>

      {loading ? (
        <div style={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : jobs.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
          <div>No jobs found. Try a different search or run the Upwork scraper first.</div>
        </div>
      ) : (
        <div style={styles.grid}>
          {jobs.map(job => (
            <UpworkJobCard
              key={job._id}
              job={job}
              onSelect={setSelectedJob}
              onStatusChange={handleStatusChange}
              onDelete={handleDeleteJob}
              brandId={brandId}
            />
          ))}
        </div>
      )}

      {!loading && pages > 1 && (
        <div style={styles.pagination}>
          <button style={{ ...styles.pageBtn, opacity: page === 1 ? 0.4 : 1 }} disabled={page === 1} onClick={() => fetchJobs(page - 1)}>← Prev</button>
          <span style={styles.pageInfo}>Page {page} of {pages}</span>
          <button style={{ ...styles.pageBtn, opacity: page === pages ? 0.4 : 1 }} disabled={page === pages} onClick={() => fetchJobs(page + 1)}>Next →</button>
        </div>
      )}

      {selectedJob && <JobDetailModal key={selectedJob._id} job={selectedJob} onClose={() => setSelectedJob(null)} onJobUpdated={handleJobUpdated} />}
    </div>
  )
}