import React, { useState, useEffect, useRef, useMemo } from 'react'

const STEP_COLORS = { pending: '#ccc', active: '#fd7e14', done: '#198754', error: '#dc3545' }

/** Parse Gulf filter stats from pipeline SSE log lines (fallback when results object is incomplete). */
function parseGulfStatsFromLogs(lines) {
  const stats = {}
  if (!Array.isArray(lines) || !lines.length) return stats

  for (let i = lines.length - 1; i >= 0; i--) {
    const msg = lines[i] || ''

    if (stats.jobsKept == null && msg.includes('Gulf location filter: kept')) {
      const m = msg.match(/kept (\d+)\/(\d+) jobs \((\d+) dropped/)
      if (m) {
        stats.jobsKept = parseInt(m[1], 10)
        stats.jobsEvaluated = parseInt(m[2], 10)
        stats.jobsFilteredOut = parseInt(m[3], 10)
      }
    }

    if (stats.jobsFilteredOut == null && msg.includes('No jobs left after Gulf location filter')) {
      const m = msg.match(/\((\d+) dropped\)/)
      if (m) stats.jobsFilteredOut = parseInt(m[1], 10)
    }

    if (stats.scraped == null && msg.includes('Pipeline complete:')) {
      try {
        const json = msg.match(/\{[\s\S]*\}/)?.[0]
        if (json) {
          const parsed = JSON.parse(json)
          if (parsed.scraped != null) stats.scraped = parsed.scraped
          if (parsed.jobsFilteredOut != null) stats.jobsFilteredOut = parsed.jobsFilteredOut
          if (parsed.jobsKept != null) stats.jobsKept = parsed.jobsKept
          if (parsed.jobsCapDropped != null) stats.jobsCapDropped = parsed.jobsCapDropped
        }
      } catch { /* ignore malformed log JSON */ }
    }
  }

  return stats
}

function StepIndicator({ steps, currentStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '24px' }}>
      {steps.map((step, idx) => (
        <React.Fragment key={step}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%',
              background: STEP_COLORS[currentStep > idx ? 'done' : currentStep === idx ? 'active' : 'pending'],
              color: '#fff', fontWeight: '700', fontSize: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.3s',
              animation: currentStep === idx ? 'stepPulse 1.2s ease-in-out infinite' : 'none'
            }}>
              {currentStep > idx ? '✓' : idx + 1}
            </div>
            <div style={{ fontSize: '11px', color: currentStep === idx ? '#fd7e14' : '#888', fontWeight: currentStep === idx ? '600' : '400', whiteSpace: 'nowrap' }}>
              {step}
            </div>
          </div>
          {idx < steps.length - 1 && (
            <div style={{
              flex: 1, height: '3px',
              background: currentStep > idx ? '#198754' : '#e0e0e0',
              margin: '0 8px', marginBottom: '24px',
              transition: 'background 0.3s'
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default function ScrapeProgressModal({ brandId, action, brandSlug, onClose }) {
  const [step, setStep] = useState(0) // 0-3
  const [status, setStatus] = useState('running') // running | completed | failed
  const [finalResult, setFinalResult] = useState(null)
  const [logLines, setLogLines] = useState([])
  const [runId, setRunId] = useState(null)
  const [error, setError] = useState(null)
  const startedRef = useRef(false)
  const evtSourceRef = useRef(null)

  const isLeadsScrape = action === 'scrape-leads'
  const isLinkedin = !isLeadsScrape && (brandSlug === 'linkedin' || brandSlug === 'linkedin-gulf')
  const steps = isLeadsScrape
    ? ['Run Apify Actor', 'Qualify Leads', 'Import Contacts']
    : isLinkedin
      ? ['Fetch Jobs', 'Find Companies', 'Get HR Emails', 'Create Contacts']
      : ['Fetch Jobs', 'Extract Companies', 'Get HR Emails', 'Create Contacts']

  // Start the pipeline run — only once (ref guard survives React StrictMode double-invoke)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const startRun = async () => {
      try {
        const res = await fetch(`/api/brands/${brandId}/pipeline/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        })
        const data = await res.json()
        if (!res.ok) {
          if (res.status === 409) {
            setError(data.error || 'Pipeline already running for this brand.')
          } else {
            setError(data.error || 'Failed to start pipeline.')
          }
          setStatus('failed')
          return
        }
        setRunId(data.runId)
      } catch (err) {
        setError(err.message)
        setStatus('failed')
      }
    }

    startRun()
  }, [brandId, action])

  // Connect to SSE once we have runId
  useEffect(() => {
    if (!runId) return

    const evtSource = new EventSource(`/api/brands/${brandId}/pipeline/logs/${runId}`, { withCredentials: true })
    evtSourceRef.current = evtSource

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'log') {
          const msg = data.message || ''
          setLogLines(prev => [...prev, msg])
          if (isLeadsScrape) {
            if (msg.includes('SCRAPE-LEADS') || msg.includes('Apify actor=')) {
              setStep(0)
            } else if (msg.includes('Mapped ') || msg.includes('Qualified ')) {
              setStep(1)
            } else if (msg.includes('Auto-imported') || msg.includes('Pipeline complete')) {
              setStep(2)
            }
          } else if (msg.includes('STEP 1') || msg.includes('Running Upwork') || msg.includes('Running LinkedIn') || msg.includes('Scraping jobs')) {
            setStep(0)
          } else if (msg.includes('STEP 2') || msg.includes('Employees Actor') || msg.includes('Extracting') || msg.includes('Companies found')) {
            setStep(1)
          } else if (msg.includes('STEP 3') || msg.includes('Matching') || msg.includes('storing contacts') || msg.includes('New employees')) {
            setStep(2)
          } else if (msg.includes('Gulf location filter') || msg.includes('No jobs left after Gulf')) {
            setStep(1)
          } else if (msg.includes('Pipeline complete')) {
            setStep(3)
          }
        } else if (data.type === 'complete') {
          // Only accept complete for THIS runId — ignore stray events from other runs
          if (data.runId && data.runId !== runId) return
          if (data.status === 'failed') {
            setError(data.error || 'Pipeline failed.')
            setStatus('failed')
          } else {
            setFinalResult(data.results)
            setStep(isLeadsScrape ? 2 : 3)
            setStatus('completed')
          }
          evtSource.close()
        } else if (data.type === 'error') {
          setError(data.message)
          setStatus('failed')
          evtSource.close()
        }
      } catch {}
    }

    evtSource.onerror = () => {
      evtSource.close()
    }

    return () => {
      evtSource.close()
    }
  }, [runId, brandId])

  const handleClose = () => {
    evtSourceRef.current?.close()
    onClose()
  }

  const logStats = useMemo(() => parseGulfStatsFromLogs(logLines), [logLines])

  const r = useMemo(() => ({
    ...finalResult,
    scraped: finalResult?.scraped ?? logStats.scraped ?? 0,
    jobsKept: finalResult?.jobsKept ?? logStats.jobsKept ?? 0,
    jobsFilteredOut: finalResult?.jobsFilteredOut ?? logStats.jobsFilteredOut ?? 0,
    jobsCapDropped: finalResult?.jobsCapDropped ?? logStats.jobsCapDropped ?? 0,
    jobsEvaluated: logStats.jobsEvaluated ?? finalResult?.scraped ?? logStats.scraped ?? 0,
  }), [finalResult, logStats])

  const isGulfLinkedin = brandSlug === 'linkedin-gulf'
  const gulfAllFiltered = isGulfLinkedin && (r.jobsFilteredOut || 0) > 0 && (r.jobsKept || 0) === 0 && (r.contactsCreated || 0) === 0

  const resultCards = isLeadsScrape
    ? [
        { label: 'Scraped', value: r.scraped || 0, color: '#0f3460' },
        { label: 'Imported', value: r.imported || 0, color: '#198754' },
      ]
    : isGulfLinkedin
      ? [
          { label: 'Raw Jobs', value: r.scraped || 0, color: '#0f3460' },
          { label: 'Gulf Kept', value: r.jobsKept || 0, color: '#20c997' },
          { label: 'Gulf Dropped', value: r.jobsFilteredOut || 0, color: '#dc3545' },
          { label: 'HR Emails', value: r.employeesFound || 0, color: '#fd7e14' },
          { label: 'Contacts', value: r.contactsCreated || 0, color: '#198754' },
        ]
      : [
          { label: 'Raw Jobs', value: r.scraped || 0, color: '#0f3460' },
          { label: 'Companies Found', value: r.companiesMatched || 0, color: '#6610f2' },
          { label: 'Jobs Stored', value: r.jobsStored || 0, color: '#20c997' },
          { label: 'HR Emails Found', value: r.employeesFound || 0, color: '#fd7e14' },
          { label: 'Contacts Created', value: r.contactsCreated || 0, color: '#198754' },
        ]

  function completionMessage() {
    if (isLeadsScrape) {
      return (r.imported || 0) > 0
        ? `${r.imported} new contact${r.imported !== 1 ? 's' : ''} imported (${r.scraped || 0} scraped from Apify).`
        : `No new contacts imported — ${r.scraped || 0} scraped (duplicates or below qualification threshold).`
    }
    if ((r.contactsCreated || 0) > 0) {
      return `${r.contactsCreated} new contact${r.contactsCreated !== 1 ? 's' : ''} created and ready to email!`
    }
    if (gulfAllFiltered) {
      const evaluated = r.jobsEvaluated || r.scraped || 0
      const capNote = evaluated < (r.scraped || 0)
        ? ` (${r.scraped} fetched from Apify, ${evaluated} evaluated before cap)`
        : ''
      return `No Gulf-based companies found — ${r.jobsFilteredOut || evaluated} job(s) filtered out${capNote}. Remote roles require company HQ in GCC (Saudi Arabia, UAE, Qatar, Kuwait, Oman, Bahrain).`
    }
    if (isGulfLinkedin && (r.jobsFilteredOut || 0) > 0) {
      const capNote = (r.jobsCapDropped || 0) > 0 ? ` (${r.jobsCapDropped} over job cap)` : ''
      return `No new contacts — ${r.jobsKept || 0} Gulf job(s) kept from ${r.scraped || 0} fetched, ${r.jobsFilteredOut} dropped by Gulf filter${capNote}.`
    }
    return 'No new contacts created — all companies already cached.'
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, padding: '16px'
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '640px',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #f0f0f0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {status === 'running' && (
              <div style={{
                width: '22px', height: '22px', borderRadius: '50%',
                border: '3px solid #fd7e14', borderTopColor: 'transparent',
                animation: 'spin 0.8s linear infinite',
                flexShrink: 0
              }} />
            )}
            <div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a2e' }}>
                {isLeadsScrape ? 'Fetch Gulf Leads' : `${isLinkedin ? 'LinkedIn' : 'Upwork'} Scraping`}
              </div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                {status === 'running' ? 'Running...' : status === 'completed' ? '✓ Complete' : '✗ Failed'}
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#aaa' }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '24px', flex: 1 }}>
          <StepIndicator steps={steps} currentStep={step} />

          {/* Results — update in real-time as step advances */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isLeadsScrape ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
            gap: '8px',
            marginBottom: '24px'
          }}>
            {resultCards.map(card => (
              <div key={card.label} style={{
                background: card.color + '15', border: `1px solid ${card.color}30`,
                borderRadius: '10px', padding: '12px 8px', textAlign: 'center'
              }}>
                <div style={{ fontSize: '24px', fontWeight: '800', color: card.color }}>
                  {card.value}
                </div>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '3px', fontWeight: '500' }}>{card.label}</div>
              </div>
            ))}
          </div>

          {/* Status message based on step */}
          {status === 'running' && (
            <div style={{
              background: '#f8f9fa', borderRadius: '10px', padding: '14px 16px',
              fontSize: '13px', color: '#555', textAlign: 'center'
            }}>
              {isLeadsScrape && step === 0 && 'Running Apify lead actor (Gulf filters)...'}
              {isLeadsScrape && step === 1 && 'Mapping results and qualifying leads...'}
              {isLeadsScrape && step === 2 && 'Saving new contacts to database...'}
              {!isLeadsScrape && step === 0 && 'Fetching LinkedIn job postings...'}
              {!isLeadsScrape && step === 1 && 'Analyzing companies and checking cache...'}
              {!isLeadsScrape && step === 2 && 'Finding HR emails via LinkedIn Employees actor...'}
              {!isLeadsScrape && step === 3 && 'Creating contacts from Cartesian product...'}
            </div>
          )}

          {status === 'failed' && error && (
            <div style={{
              background: '#fff5f5', border: '1px solid #f8d7da', borderRadius: '10px',
              padding: '14px 16px', fontSize: '13px', color: '#dc3545', textAlign: 'center'
            }}>
              {error}
            </div>
          )}

          {status === 'completed' && !error && (
            <div style={{
              background: gulfAllFiltered ? '#fff8e6' : '#f0fff4',
              border: `1px solid ${gulfAllFiltered ? '#ffc107' : '#9ae6b4'}`,
              borderRadius: '10px',
              padding: '14px 16px',
              fontSize: '13px',
              color: gulfAllFiltered ? '#856404' : '#276749',
              textAlign: 'center'
            }}>
              {completionMessage()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid #f0f0f0', padding: '16px 24px',
          background: '#fafafa', display: 'flex', gap: '8px'
        }}>
          <button
            onClick={handleClose}
            style={{
              flex: 1, padding: '10px',
              borderRadius: '8px', border: '1px solid #ddd',
              background: '#fff', color: '#555', cursor: 'pointer', fontSize: '13px', fontWeight: '600'
            }}
          >
            {status === 'completed' ? 'View Contacts' : 'Close'}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes stepPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(253,127,20,0.5); }
          50% { box-shadow: 0 0 0 8px rgba(253,127,20,0); }
        }
      `}</style>
    </div>
  )
}