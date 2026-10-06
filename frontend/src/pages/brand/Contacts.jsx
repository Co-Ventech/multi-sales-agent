import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import apiClient from '../../api/client'
import ContactsTable from '../../components/ContactsTable'
import StatusBadge from '../../components/StatusBadge'
import ScrapeProgressModal from '../../components/ScrapeProgressModal'

// ── Contact Detail Modal ───────────────────────────────────────────────────────
function isLinkedInProfileUrl(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.trim().toLowerCase()
  if (!u.includes('linkedin.com')) return false
  if (u.includes('/jobs/') || u.includes('/job-apply')) return false
  return u.includes('/in/') || u.includes('/pub/')
}

function isLinkedInJobUrl(url) {
  if (!url || typeof url !== 'string') return false
  return /linkedin\.com\/jobs\//i.test(url)
}

function personLinkedinUrl(contact, hrProfileUrl) {
  if (isLinkedInProfileUrl(contact?.linkedinUrl)) return contact.linkedinUrl
  if (isLinkedInProfileUrl(hrProfileUrl)) return hrProfileUrl
  return ''
}

function jobPostingLinkedinUrl(contact) {
  if (contact?.jobLinkedinUrl && isLinkedInJobUrl(contact.jobLinkedinUrl)) return contact.jobLinkedinUrl
  if (isLinkedInJobUrl(contact?.linkedinUrl)) return contact.linkedinUrl
  return ''
}

function Field({ label, value, link }) {
  if (!value && value !== 0) return null
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
      {link
        ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: '#3182ce', fontSize: '13px', wordBreak: 'break-all' }}>{value}</a>
        : <div style={{ fontSize: '13px', color: '#1a1a2e' }}>{value}</div>
      }
    </div>
  )
}

function ContactModal({ contact: initialContact, onClose, onSave }) {
  const [c, setC] = useState(initialContact)
  const [tab, setTab] = useState('details')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    email: initialContact.email || '', firstName: initialContact.firstName || '', lastName: initialContact.lastName || '',
    companyName: initialContact.companyName || '', jobTitle: initialContact.jobTitle || '', status: initialContact.status || '',
    emailSubject: initialContact.emailSubject || '', generatedEmailContent: initialContact.generatedEmailContent || ''
  })
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [smtpAccounts, setSmtpAccounts] = useState([])
  const [selectedSmtpId, setSelectedSmtpId] = useState('')
  const [linkedinJobs, setLinkedinJobs] = useState([])
  const [hrLinkedinUrl, setHrLinkedinUrl] = useState('')
  const [loadingJob, setLoadingJob] = useState(false)
  const [upworkJobs, setUpworkJobs] = useState([])
  const [loadingUpworkJob, setLoadingUpworkJob] = useState(false)

  useEffect(() => {
    apiClient.get(`/brands/${initialContact.brandId}/smtp`)
      .then(res => setSmtpAccounts((res.data || []).filter(a => a.isActive !== false)))
      .catch(() => {})
  }, [initialContact.brandId])

  // Load LinkedIn jobs (Job Details) + HR profile URL (Person)
  useEffect(() => {
    const hasJobIds = initialContact.linkedinJobIds?.length > 0
    const hasLc = !!initialContact.linkedinContactId
    const hasJobUrl = isLinkedInJobUrl(initialContact.jobLinkedinUrl) || isLinkedInJobUrl(initialContact.linkedinUrl)
    const hasCompany = !!initialContact.companyLinkedin
    const upworkOnly = initialContact.upworkJobIds?.length > 0 && !hasJobIds && !hasJobUrl && !hasLc
    if (upworkOnly || (!hasJobIds && !hasLc && !hasJobUrl && !hasCompany)) return
    setLoadingJob(true)
    apiClient.get(`/brands/${initialContact.brandId}/apify/linkedin-jobs?contactId=${initialContact._id}`)
      .then(res => {
        setLinkedinJobs(res.data?.jobs || [])
        const profileUrl = res.data?.contact?.linkedinUrl || ''
        if (isLinkedInProfileUrl(profileUrl)) setHrLinkedinUrl(profileUrl)
      })
      .catch(() => {})
      .finally(() => setLoadingJob(false))
  }, [initialContact._id, initialContact.brandId, initialContact.linkedinContactId, initialContact.linkedinJobIds?.length, initialContact.jobLinkedinUrl, initialContact.companyLinkedin])

  // Load Upwork job(s) for this contact via the Contact's upworkJobIds
  useEffect(() => {
    if (!initialContact.upworkJobIds || initialContact.upworkJobIds.length === 0) return
    setLoadingUpworkJob(true)
    apiClient.get(`/brands/${initialContact.brandId}/apify/upwork-jobs?contactId=${initialContact._id}`)
      .then(res => {
        setUpworkJobs(res.data?.jobs || [])
      })
      .catch(() => {})
      .finally(() => setLoadingUpworkJob(false))
  }, [initialContact._id])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiClient.put(`/brands/${c.brandId}/contacts/${c._id}`, editForm)
      setC(res.data)
      onSave && onSave(res.data)
      setEditing(false)
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await apiClient.post(`/brands/${c.brandId}/contacts/${c._id}/generate`)
      const updated = { ...c, status: 'Generated', emailSubject: res.data.subject, generatedEmailContent: res.data.body }
      setC(updated)
      setEditForm(f => ({ ...f, status: 'Generated', emailSubject: res.data.subject, generatedEmailContent: res.data.body }))
      onSave && onSave(updated)
      setTab('email')
    } catch (err) {
      alert(err.response?.data?.error || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const [sendingFollowUp, setSendingFollowUp] = useState(false)
  const handleSendFollowUp = async (dryRun = false) => {
    const fromLabel = selectedSmtpId
      ? (smtpAccounts.find(a => a._id === selectedSmtpId)?.fromEmail || 'selected account')
      : 'auto-rotation'
    const action = dryRun ? 'preview the follow-up email' : `send a follow-up to ${c.email} from ${fromLabel}`
    if (!window.confirm(`${dryRun ? 'Generate' : 'Send'}: ${action}?`)) return
    setSendingFollowUp(true)
    try {
      const body = { dryRun, ...(selectedSmtpId && !dryRun ? { smtpAccountId: selectedSmtpId } : {}) }
      const res = await apiClient.post(`/brands/${c.brandId}/contacts/${c._id}/send-followup`, body)
      if (dryRun) {
        alert(`Follow-up #${res.data.followUpNum} preview:\n\nSubject: ${res.data.subject}\n\n${res.data.body}`)
      } else {
        alert(`Follow-up #${res.data.followUpNum} sent via ${res.data.sentFrom}`)
        const newFu = { num: res.data.followUpNum, subject: res.data.subject, sentAt: new Date() }
        const updated = { ...c, followUps: [...(c.followUps || []), newFu] }
        setC(updated)
        onSave && onSave(updated)
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Follow-up failed')
    } finally {
      setSendingFollowUp(false)
    }
  }

  const handleSendNow = async () => {
    const fromLabel = selectedSmtpId
      ? (smtpAccounts.find(a => a._id === selectedSmtpId)?.fromEmail || 'selected account')
      : 'auto-rotation'
    if (!window.confirm(`Send email to ${c.email} from ${fromLabel}?`)) return
    setSending(true)
    try {
      const body = selectedSmtpId ? { smtpAccountId: selectedSmtpId } : {}
      const res = await apiClient.post(`/brands/${c.brandId}/contacts/${c._id}/send`, body)
      const updated = { ...c, status: 'Sent', sentFrom: res.data.sentFrom }
      setC(updated)
      onSave && onSave(updated)
      alert(`Sent via ${res.data.sentFrom}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const tabBtn = (t, label) => (
    <button onClick={() => setTab(t)} type="button" style={{
      padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px',
      background: tab === t ? '#1a1a2e' : '#f0f0f0', color: tab === t ? '#fff' : '#555', fontWeight: tab === t ? 600 : 400
    }}>{label}</button>
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: '14px', width: '100%', maxWidth: '700px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a2e' }}>{c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</div>
              <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>
                {c.email}
                {c.jobTitle && <span style={{ marginLeft: '8px', color: '#555' }}>· {c.jobTitle}</span>}
                {c.companyName && <span style={{ marginLeft: '8px', color: '#555' }}>@ {c.companyName}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={c.status} />
              {c.abVariant && (
                <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: c.abVariant === 'A' ? '#e8f0fe' : '#e6f4ea', color: c.abVariant === 'A' ? '#0d6efd' : '#198754' }}>
                  Variant {c.abVariant}
                </span>
              )}
              {['Pending', 'Failed'].includes(c.status) && (
                <button onClick={handleGenerate} disabled={generating}
                  style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#198754', color: '#fff', cursor: generating ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                  {generating ? 'Generating...' : '⚡ Generate'}
                </button>
              )}
              {['Generated', 'Sent', 'Replied', 'Bounced', 'SpamBlocked', 'DryRun'].includes(c.status) && (
                <button onClick={handleGenerate} disabled={generating}
                  title="Re-run the AI on this contact (useful after updating the system prompt)"
                  style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #6c757d', background: '#fff', color: '#6c757d', cursor: generating ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                  {generating ? 'Regenerating...' : '↻ Regenerate'}
                </button>
              )}
              {c.status === 'Generated' && (
                <>
                  {smtpAccounts.length > 0 && (
                    <select
                      value={selectedSmtpId}
                      onChange={e => setSelectedSmtpId(e.target.value)}
                      title="Send from"
                      style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #ccc', background: '#fff', fontSize: '12px', maxWidth: '180px' }}
                    >
                      <option value="">Auto-rotate</option>
                      {smtpAccounts.map(a => (
                        <option key={a._id} value={a._id}>
                          {a.fromName ? `${a.fromName} (${a.fromEmail})` : a.fromEmail}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={handleSendNow} disabled={sending}
                    style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#0f3460', color: '#fff', cursor: sending ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    {sending ? 'Sending...' : '✉ Send Now'}
                  </button>
                </>
              )}
              {c.status === 'Sent' && !c.dateReplied && !c.dateBounced && (
                <>
                  <button onClick={() => handleSendFollowUp(true)} disabled={sendingFollowUp}
                    title="Generate follow-up text without sending (preview)"
                    style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #17a2b8', background: '#fff', color: '#17a2b8', cursor: sendingFollowUp ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    {sendingFollowUp ? '...' : '👀 Preview FU'}
                  </button>
                  <button onClick={() => handleSendFollowUp(false)} disabled={sendingFollowUp}
                    title="Send follow-up #N to this contact now (ignores day-cutoff — useful for testing)"
                    style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#17a2b8', color: '#fff', cursor: sendingFollowUp ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    {sendingFollowUp ? 'Sending...' : `🔁 Send Follow-up #${(c.followUps?.length || 0) + 1}`}
                  </button>
                </>
              )}
              <button onClick={() => { setEditing(!editing); setTab('details') }} style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #0d6efd', background: editing ? '#0d6efd' : '#fff', color: editing ? '#fff' : '#0d6efd', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                {editing ? 'Cancel' : 'Edit'}
              </button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#aaa', lineHeight: 1 }}>×</button>
            </div>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
            {tabBtn('details', 'Contact Details')}
            {tabBtn('email', 'Email Preview')}
            {c.replyContent && tabBtn('reply', '💬 Reply')}
            {tabBtn('tracking', 'Tracking')}
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>

          {tab === 'details' && editing && (
            <div>
              <SectionHead>Edit Contact</SectionHead>
              {[
                { label: 'First Name', key: 'firstName' },
                { label: 'Last Name', key: 'lastName' },
                { label: 'Email', key: 'email' },
                { label: 'Company Name', key: 'companyName' },
                { label: 'Job Title', key: 'jobTitle' },
              ].map(({ label, key }) => (
                <div key={key} style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
                  <input
                    value={editForm[key]}
                    onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>Status</div>
                <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
                  {['Pending','Generated','Sent','Replied','Bounced','Failed','SpamBlocked','DryRun'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {(editForm.emailSubject || editForm.generatedEmailContent) && (
                <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '14px', marginTop: '4px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#333', marginBottom: '10px' }}>Email Content (edit before sending)</div>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>Subject Line</div>
                    <input
                      value={editForm.emailSubject}
                      onChange={e => setEditForm(f => ({ ...f, emailSubject: e.target.value }))}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>Email Body</div>
                    <textarea
                      value={editForm.generatedEmailContent}
                      onChange={e => setEditForm(f => ({ ...f, generatedEmailContent: e.target.value }))}
                      rows={10}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical', lineHeight: '1.6', fontFamily: 'inherit' }}
                    />
                  </div>
                </div>
              )}
              <button onClick={handleSave} disabled={saving}
                style={{ padding: '9px 20px', background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '7px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}

          {tab === 'details' && !editing && (
            <div>
              {/* Person */}
              <SectionHead>Person</SectionHead>
              <Grid>
                <Field label="First Name"      value={c.firstName} />
                <Field label="Last Name"       value={c.lastName} />
                <Field label="Email"           value={c.email} />
                <Field label="Job Title"       value={c.jobTitle} />
                <Field label="Headline"        value={c.headline} />
                <Field label="Seniority"       value={c.seniorityLevel} />
                <Field label="Function"        value={c.functionalLevel} />
                <Field label="Email Status"    value={c.emailStatus} />
                <Field label="LinkedIn"        value={personLinkedinUrl(c, hrLinkedinUrl)} link />
                <Field label="Lead Score"      value={c.leadScore} />
              </Grid>

              {/* Location */}
              <SectionHead>Location</SectionHead>
              <Grid>
                <Field label="City"    value={c.city} />
                <Field label="State"   value={c.state} />
                <Field label="Country" value={c.country} />
              </Grid>

              {/* Company */}
              <SectionHead>Company</SectionHead>
              <Grid>
                <Field label="Company Name"     value={c.companyName} />
                <Field label="Domain"           value={c.companyDomain} />
                <Field label="Website"          value={c.companyWebsite} link />
                <Field label="Industry"         value={c.industry} />
                <Field label="Company Size"     value={c.companySize} />
                <Field label="Annual Revenue"   value={c.companyAnnualRevenue} />
                <Field label="Total Funding"    value={c.companyTotalFunding} />
                <Field label="LinkedIn"         value={c.companyLinkedin} link />
                <Field label="Phone"            value={c.companyPhone} />
              </Grid>
              {c.companyDescription && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>Company Description</div>
                  <div style={{ fontSize: '13px', color: '#555', lineHeight: '1.6' }}>{c.companyDescription}</div>
                </div>
              )}

              {/* Tech Stack */}
              {c.technologyStack?.length > 0 && (
                <div>
                  <SectionHead>Tech Stack</SectionHead>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {c.technologyStack.map(t => (
                      <span key={t} style={{ padding: '3px 9px', background: '#e9ecef', borderRadius: '12px', fontSize: '12px', color: '#555' }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* LinkedIn Job(s) — hidden for Upwork-only contacts (they use Upwork Job Details below) */}
              {(linkedinJobs.length > 0 || loadingJob || jobPostingLinkedinUrl(c) || c.linkedinJobIds?.length > 0) && (
                <div>
                  <SectionHead>Job Details ({linkedinJobs.length || (jobPostingLinkedinUrl(c) ? 1 : 0)})</SectionHead>
                  {loadingJob ? (
                    <div style={{ color: '#aaa', fontSize: '13px', padding: '8px 0' }}>Loading job data...</div>
                  ) : linkedinJobs.length === 0 && jobPostingLinkedinUrl(c) ? (
                    <div style={{ border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px', marginBottom: '12px', background: '#fafafa' }}>
                      <Grid>
                        <Field label="LinkedIn Job" value={jobPostingLinkedinUrl(c)} link />
                      </Grid>
                    </div>
                  ) : (
                    linkedinJobs.map((job, idx) => (
                      <div key={job._id || idx} style={{ border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px', marginBottom: '12px', background: '#fafafa' }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a2e', marginBottom: '6px' }}>{job.title}</div>
                        <Grid>
                          <Field label="Employment Type"  value={job.employmentType} />
                          <Field label="Workplace"        value={job.workplaceType} />
                          <Field label="Experience"      value={job.experienceLevel} />
                          <Field label="Salary"          value={job.salaryText || (job.salaryMin ? `$${job.salaryMin.toLocaleString()} – ${job.salaryMax ? '$' + job.salaryMax.toLocaleString() : 'N/A'}` : null)} />
                          <Field label="Applicants"      value={job.applicants != null ? job.applicants.toLocaleString() : null} />
                          <Field label="Posted"         value={job.postedDate ? new Date(job.postedDate).toLocaleDateString() : null} />
                          <Field label="LinkedIn Job"   value={job.linkedinUrl} link />
                          <Field label="Company"         value={job.company?.name} />
                        </Grid>
                        {job.company?.description && (
                          <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: '5px' }}>Company Description</div>
                            <div style={{ fontSize: '13px', color: '#444', lineHeight: '1.6', background: '#fff', border: '1px solid #eee', borderRadius: '7px', padding: '10px 12px' }}>
                              {job.company.description}
                            </div>
                          </div>
                        )}
                        {job.descriptionText && (
                          <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: '5px' }}>Description</div>
                            <div style={{
                              fontSize: '13px', color: '#444', lineHeight: '1.6', maxHeight: '120px', overflowY: 'auto',
                              background: '#fff', border: '1px solid #eee', borderRadius: '7px', padding: '10px 12px', whiteSpace: 'pre-wrap'
                            }}>
                              {job.descriptionText}
                            </div>
                          </div>
                        )}
                        {job.applyMethod?.companyApplyUrl && (
                          <div style={{ marginTop: '8px' }}>
                            <a href={job.applyMethod.companyApplyUrl} target="_blank" rel="noopener noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: '#0d6efd', color: '#fff', borderRadius: '6px', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}>
                              Apply on Company Site ↗
                            </a>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Upwork Job(s) */}
              {(upworkJobs.length > 0 || loadingUpworkJob) && (
                <div>
                  <SectionHead>Upwork Job Details ({upworkJobs.length})</SectionHead>
                  {loadingUpworkJob ? (
                    <div style={{ color: '#aaa', fontSize: '13px', padding: '8px 0' }}>Loading Upwork job data...</div>
                  ) : (
                    upworkJobs.map((job, idx) => (
                      <div key={job._id || idx} style={{ border: '1px solid #e8e8e8', borderRadius: '10px', padding: '14px', marginBottom: '12px', background: '#fafafa' }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a2e', marginBottom: '6px' }}>{job.title}</div>
                        <Grid>
                          <Field label="Job Type"       value={job.jobType} />
                          <Field label="Experience"     value={job.experienceLevel} />
                          <Field label="Budget"         value={job.budget} />
                          <Field label="Client Name"    value={job.clientName} />
                          <Field label="Client Location" value={job.clientLocation} />
                          <Field label="Client Rating"  value={job.clientRating != null ? `${job.clientRating}/5` : null} />
                          <Field label="Hourly Rate"    value={job.clientAvgHourlyRate != null ? `$${job.clientAvgHourlyRate.toFixed(2)}/hr` : null} />
                          <Field label="Client Hire Rate" value={job.clientHireRatePercent != null ? `${job.clientHireRatePercent}%` : null} />
                          <Field label="Proposals"      value={job.proposals != null ? job.proposals.toLocaleString() : null} />
                          <Field label="Total Spent"    value={job.clientTotalSpent != null ? `$${Number(job.clientTotalSpent).toLocaleString()}` : null} />
                          <Field label="Payment Verified" value={job.paymentVerified ? 'Yes' : 'No'} />
                          <Field label="Has Hired"       value={job.hasHired ? 'Yes' : 'No'} />
                          <Field label="Posted"          value={job.absoluteDate ? new Date(job.absoluteDate).toLocaleDateString() : job.relativeDate} />
                          <Field label="Upwork Job"      value={job.url} link />
                          <Field label="Company (extracted)" value={job.extractedCompany} />
                        </Grid>
                        {job.description && (
                          <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: '5px' }}>Description</div>
                            <div style={{
                              fontSize: '13px', color: '#444', lineHeight: '1.6', maxHeight: '120px', overflowY: 'auto',
                              background: '#fff', border: '1px solid #eee', borderRadius: '7px', padding: '10px 12px', whiteSpace: 'pre-wrap'
                            }}>
                              {job.description}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'email' && (
            <div>
              {c.emailSubject || c.generatedEmailContent ? (
                <>
                  {/* Email client-style preview */}
                  <div style={{ border: '1px solid #e0e0e0', borderRadius: '10px', overflow: 'hidden' }}>
                    {/* Email header bar */}
                    <div style={{ background: '#f7f7f7', padding: '12px 16px', borderBottom: '1px solid #e0e0e0' }}>
                      <div style={{ fontSize: '12px', color: '#888' }}>
                        <span style={{ fontWeight: 600, color: '#333' }}>From: </span>{c.sentFrom || '(not sent yet)'}
                      </div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                        <span style={{ fontWeight: 600, color: '#333' }}>To: </span>{c.email}
                      </div>
                      {c.emailSubject && (
                        <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a1a2e', marginTop: '8px' }}>{c.emailSubject}</div>
                      )}
                    </div>
                    {/* Email body */}
                    <div style={{ padding: '20px', background: '#fff' }}>
                      {c.generatedEmailContent ? (
                        <div style={{ fontSize: '14px', lineHeight: '1.8', color: '#333', whiteSpace: 'pre-wrap' }}>
                          {c.generatedEmailContent}
                        </div>
                      ) : (
                        <div style={{ color: '#aaa', fontSize: '13px' }}>Email body not generated yet.</div>
                      )}
                    </div>
                  </div>
                  {c.dateSent && (
                    <div style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>
                      Sent: {new Date(c.dateSent).toLocaleString()}
                      {c.sentFrom && ` · via ${c.sentFrom}`}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#aaa' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>✉️</div>
                  <div>No email generated yet. Run the pipeline to generate and send.</div>
                </div>
              )}
            </div>
          )}

          {tab === 'reply' && (
            <div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#276749', textTransform: 'uppercase', marginBottom: '4px' }}>Reply From</div>
                <div style={{ fontSize: '13px', color: '#1a1a2e' }}>{c.email}</div>
                {c.dateReplied && (
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                    Received: {new Date(c.dateReplied).toLocaleString()}
                  </div>
                )}
              </div>
              <div style={{ background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#276749', textTransform: 'uppercase', marginBottom: '8px' }}>Reply Content</div>
                <div style={{ fontSize: '14px', color: '#1a1a2e', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                  {c.replyContent}
                </div>
              </div>
            </div>
          )}

          {tab === 'tracking' && (
            <div>
              <SectionHead>Pipeline Status</SectionHead>
              <Grid>
                <Field label="Status"        value={c.status} />
                <Field label="A/B Variant"   value={c.abVariant || 'Not assigned'} />
                <Field label="Sent From"     value={c.sentFrom} />
                <Field label="Date Sent"     value={c.dateSent ? new Date(c.dateSent).toLocaleString() : null} />
                <Field label="Date Replied"  value={c.dateReplied ? new Date(c.dateReplied).toLocaleString() : null} />
                <Field label="Date Bounced"  value={c.dateBounced ? new Date(c.dateBounced).toLocaleString() : null} />
                <Field label="Import Source" value={c.importSource} />
                <Field label="Lead Score"    value={c.leadScore} />
              </Grid>
              {c.notes && (
                <div style={{ marginTop: '16px' }}>
                  <SectionHead>Notes</SectionHead>
                  <div style={{ fontSize: '13px', color: '#555', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{c.notes}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionHead({ children }) {
  return <div style={{ fontSize: '12px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', marginTop: '16px', borderBottom: '1px solid #f0f0f0', paddingBottom: '4px' }}>{children}</div>
}

function Grid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '4px' }}>{children}</div>
}

export default function Contacts() {
  const { brandId } = useParams()
  const [contacts, setContacts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedContact, setSelectedContact] = useState(null)
  const [importLoading, setImportLoading] = useState(false)
  const [scrapingLinkedin, setScrapingLinkedin] = useState(false)
  const [scrapingUpwork, setScrapingUpwork] = useState(false)
  const [brandSlug, setBrandSlug] = useState('')
  const [scrapeModalOpen, setScrapeModalOpen] = useState(false)
  const [brandName, setBrandName] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchContacts = async (p = page, s = statusFilter, q = search, df = dateFrom, dt = dateTo) => {
    setLoading(true)
    try {
      const params = { page: p, limit: 50 }
      if (s && s !== 'all') params.status = s
      if (q) params.search = q
      if (df) { params.dateFrom = df; params.dateField = 'dateSent' }
      if (dt) { params.dateTo = dt; params.dateField = 'dateSent' }
      const res = await apiClient.get(`/brands/${brandId}/contacts`, { params })
      setContacts(res.data.contacts)
      setTotal(res.data.total)
      setPages(res.data.pages)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Detect brand slug from URL for conditional scrape buttons
    const match = window.location.pathname.match(/\/brands\/([^/]+)/)
    setBrandSlug(match ? match[1] : '')
  }, [])

  useEffect(() => {
    // Fetch brand list to detect slug from brandId in URL
    apiClient.get('/brands')
      .then(res => {
        const brand = res.data.find(b => b._id === brandId)
        if (brand) setBrandSlug(brand.slug)
      })
      .catch(() => {})
  }, [brandId])

  useEffect(() => { fetchContacts(1, statusFilter, search) }, [brandId])

  const handleStatusFilter = (s) => {
    setStatusFilter(s)
    setPage(1)
    fetchContacts(1, s, search, dateFrom, dateTo)
  }

  const handleSearch = (q) => {
    setSearch(q)
    setPage(1)
    fetchContacts(1, statusFilter, q, dateFrom, dateTo)
  }

  const handlePageChange = (p) => {
    setPage(p)
    fetchContacts(p, statusFilter, search, dateFrom, dateTo)
  }

  const applyDateFilter = () => {
    setPage(1)
    fetchContacts(1, statusFilter, search, dateFrom, dateTo)
  }

  const handleExport = async () => {
    try {
      const res = await apiClient.get(`/brands/${brandId}/contacts/export`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `contacts-${brandId}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Export failed')
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await apiClient.post(`/brands/${brandId}/contacts/import/json`, formData)
      alert(`Imported ${res.data.imported} contacts (${res.data.qualified}/${res.data.total} qualified)`)
      fetchContacts(1, statusFilter, search)
    } catch (err) {
      alert(err.response?.data?.error || 'Import failed')
    } finally {
      setImportLoading(false)
      e.target.value = ''
    }
  }

  const handleDeleteAll = async () => {
    if (!window.confirm('Delete ALL contacts for this brand? This cannot be undone.')) return
    try {
      const res = await apiClient.delete(`/brands/${brandId}/contacts`, { data: { confirm: true } })
      alert(`Deleted ${res.data.deleted} contacts`)
      fetchContacts(1, statusFilter, search)
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  const handleScrapeLinkedin = async () => {
    if (!window.confirm('Run LinkedIn scraper? This will fetch jobs and find HR emails via the LinkedIn Employees actor.')) return
    setScrapeModalOpen(true)
  }

  const handleScrapeUpwork = async () => {
    if (!window.confirm('Run Upwork scraper? This will fetch Upwork jobs, extract company names, and find HR emails via the LinkedIn Employees actor.')) return
    setScrapeModalOpen(true)
  }

  const handleFetchLeadsGulf = async () => {
    if (!window.confirm(
      'Fetch Gulf leads from Apify?\n\nThis runs the same lead actor as Co-Ventech with your Gulf location filters, qualifies leads, and imports new contacts (no cron — manual only).'
    )) return
    setScrapeModalOpen(true)
  }

  const isLinkedinBrand = brandSlug === 'linkedin'
  const isLinkedinGulfBrand = brandSlug === 'linkedin-gulf'
  const isUpworkBrand = brandSlug === 'upwork'
  const isUpworkGulfBrand = brandSlug === 'upwork-gulf'
  const isLeadsGulfBrand = brandSlug === 'leads-gulf'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e' }}>Contacts</h1>
          <p style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>{total} total contacts</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleExport} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #198754', background: '#fff', color: '#198754', cursor: 'pointer', fontSize: '13px' }}>
            Export CSV
          </button>
          <label style={{
            padding: '8px 14px', borderRadius: '8px', border: '1px solid #0d6efd',
            background: importLoading ? '#e9ecef' : '#fff', color: '#0d6efd',
            cursor: importLoading ? 'not-allowed' : 'pointer', fontSize: '13px', display: 'inline-block'
          }}>
            {importLoading ? 'Importing...' : 'Import JSON'}
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} disabled={importLoading} />
          </label>
          <button onClick={handleDeleteAll} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #dc3545', background: '#fff', color: '#dc3545', cursor: 'pointer', fontSize: '13px' }}>
            Clear All
          </button>
          {isLinkedinBrand && (
            <button
              onClick={handleScrapeLinkedin}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #0077b5', background: '#fff', color: '#0077b5', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              🔍 Scrape LinkedIn Jobs
            </button>
          )}
          {isUpworkBrand && (
            <button
              onClick={handleScrapeUpwork}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #17a2b8', background: '#fff', color: '#17a2b8', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              🔍 Scrape Upwork Jobs
            </button>
          )}
          {isLinkedinGulfBrand && (
            <button
              onClick={handleScrapeLinkedin}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #0077b5', background: '#fff', color: '#0077b5', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              🔍 Scrape LinkedIn Jobs (Gulf)
            </button>
          )}
          {isUpworkGulfBrand && (
            <button
              onClick={handleScrapeUpwork}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #17a2b8', background: '#fff', color: '#17a2b8', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              🔍 Scrape Upwork Jobs (Gulf)
            </button>
          )}
          {isLeadsGulfBrand && (
            <button
              onClick={handleFetchLeadsGulf}
              style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#0f3460', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              Fetch Gulf Leads
            </button>
          )}
        </div>
      </div>

      <ContactsTable
        contacts={contacts}
        total={total}
        page={page}
        pages={pages}
        loading={loading}
        statusFilter={statusFilter}
        onPageChange={handlePageChange}
        onStatusFilter={handleStatusFilter}
        onSearch={handleSearch}
        onRowClick={setSelectedContact}
        dateFilterUI={
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: '10px', padding: '10px 14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#555' }}>Sent between</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px' }} />
            <span style={{ fontSize: '12px', color: '#888' }}>and</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px' }} />
            <button onClick={applyDateFilter} style={{ padding: '4px 12px', borderRadius: '6px', border: 'none', background: '#0f3460', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Apply</button>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); fetchContacts(1, statusFilter, search, '', ''); }}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', fontSize: '12px' }}>Clear</button>
            )}
          </div>
        }
      />

      {/* Contact Detail Modal */}
      {selectedContact && (
        <ContactModal
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onSave={(updated) => {
            setContacts(prev => prev.map(c => c._id === updated._id ? updated : c))
            setSelectedContact(updated)
          }}
        />
      )}

      {/* Scrape Progress Modal */}
      {scrapeModalOpen && (
        <ScrapeProgressModal
          brandId={brandId}
          action={
            isLeadsGulfBrand
              ? 'scrape-leads'
              : (isLinkedinBrand || isLinkedinGulfBrand ? 'scrape-linkedin' : 'scrape-upwork')
          }
          brandSlug={brandSlug}
          onClose={() => {
            setScrapeModalOpen(false)
            fetchContacts(1, statusFilter, search)
          }}
        />
      )}
    </div>
  )
}
