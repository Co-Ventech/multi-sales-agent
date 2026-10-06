/**
 * Apify Lead Scraper — Two-step flow
 * Step 1: Configure filters → Run Actor (no DB write)
 * Step 2: Review results table → select contacts → Import to DB
 *
 * Actor: IoSHqwTR9YGhzccez ("Leads Finder — Apollo Alternative")
 * All field names, enums, and values match the actor schema exactly.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../api/client'

// ── EXACT ENUM VALUES from actor IoSHqwTR9YGhzccez ────────────────────────────

const SENIORITY_LEVEL = [
  'founder','owner','c_suite','director','partner',
  'vp','head','manager','senior','entry','trainee'
]

const FUNCTIONAL_LEVEL = [
  'finance','product_management','engineering','design','education',
  'c_suite','human_resources','information_technology','legal',
  'marketing','operations','sales'
]

const EMAIL_STATUS = ['validated','not_validated','unknown']

const COMPANY_SIZE = [
  '1-10','11-20','21-50','51-100','101-200','201-500',
  '501-1000','1001-2000','2001-5000','5001-10000',
  '10001-20000','20001-50000','50000+'
]

const FUNDING = [
  'seed','angel','series_a','series_b','series_c','series_d',
  'series_e','series_f','venture_round','debt_financing',
  'convertible_note','private_equity_round','other_round'
]

const REVENUE_OPTIONS = [
  '','100K','500K','1M','2M','5M','10M','25M','50M','100M','250M','500M','1B'
]

const COMPANY_INDUSTRY = [
  'information technology & services','construction','marketing & advertising',
  'consumer services','financial services','hospital & health care','automotive',
  'restaurants','education management','food & beverages','design','hospitality',
  'accounting','events services','retail','nonprofit organization management',
  'entertainment','electrical/electronic manufacturing','internet',
  'leisure, travel & tourism','professional training & coaching',
  'transportation/trucking/railroad','law practice','real estate',
  'health, wellness & fitness','management consulting','computer software',
  'apparel & fashion','architecture & planning','mechanical or industrial engineering',
  'insurance','telecommunications','human resources','staffing & recruiting',
  'sports','legal services','oil & energy','media production','machinery',
  'wholesale','consumer goods','music','photography','medical practice',
  'cosmetics','environmental services','graphic design',
  'business supplies & equipment','renewables & environment','facilities services',
  'publishing','food production','arts & crafts','building materials',
  'civil engineering','religious institutions','public relations & communications',
  'higher education','printing','furniture','mining & metals',
  'logistics & supply chain','research','pharmaceuticals',
  'individual & family services','medical devices','civic & social organization',
  'e-learning','security & investigations','chemicals','government administration',
  'online media','investment management','farming','writing & editing','textiles',
  'mental health care','primary/secondary education','broadcast media','biotechnology',
  'information services','international trade & development','motion pictures & film',
  'consumer electronics','banking','import & export','industrial automation',
  'recreational facilities & services','performing arts','utilities','sporting goods',
  'fine art','airlines/aviation','computer & network security','maritime',
  'luxury goods & jewelry','veterinary','venture capital & private equity',
  'commercial real estate','wine & spirits','plastics','aviation & aerospace',
  'computer games','packaging & containers','executive office','computer hardware',
  'computer networking','market research','outsourcing/offshoring',
  'program development','translation & localization','philanthropy','public safety',
  'alternative medicine','museums & institutions','warehousing','defense & space',
  'newspapers','paper & forest products','law enforcement','investment banking',
  'government relations','fund-raising','think tanks','glass, ceramics & concrete',
  'capital markets','semiconductors','animation','political organization',
  'package/freight delivery','wireless','international affairs','public policy',
  'libraries','gambling & casinos','railroad manufacture','ranching','military',
  'fishery','supermarkets','dairy','tobacco','shipbuilding','judiciary',
  'alternative dispute resolution','nanotechnology','agriculture','legislative office'
]

const MAX_FETCH = 1000

// ── Sub-components ─────────────────────────────────────────────────────────────

function MultiChip({ options, selected, onChange }) {
  const toggle = v => onChange(
    selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]
  )
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }}>
      {options.map(o => (
        <button key={o} onClick={() => toggle(o)} type="button"
          style={selected.includes(o) ? chipActive : chip}>
          {o.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  )
}

function TagInput({ value, onChange, placeholder }) {
  const [text, setText] = useState('')
  const tags = value || []
  const add = () => {
    const v = text.trim()
    if (v && !tags.includes(v)) { onChange([...tags, v]); setText('') }
  }
  const remove = t => onChange(tags.filter(x => x !== t))
  return (
    <div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder} style={{ ...inputStyle, flex: 1 }} />
        <button type="button" onClick={add} style={addTagBtn}>Add</button>
      </div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }}>
          {tags.map(t => (
            <span key={t} style={tagBadge}>
              {t}
              <span onClick={() => remove(t)}
                style={{ cursor: 'pointer', marginLeft: '5px', fontWeight: 700 }}>×</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function IndustryPicker({ label, selected, onChange }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const filtered = COMPANY_INDUSTRY.filter(i =>
    !search || i.toLowerCase().includes(search.toLowerCase())
  )
  const remove = i => onChange(selected.filter(x => x !== i))
  const toggle = i => onChange(selected.includes(i) ? selected.filter(x => x !== i) : [...selected, i])
  return (
    <div style={field}>
      <label style={labelStyle}>
        {label}
        {selected.length > 0 && (
          <span style={{ marginLeft: '8px', fontSize: '12px', color: '#3182ce' }}>
            {selected.length} selected
          </span>
        )}
      </label>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
          {selected.map(i => (
            <span key={i} style={tagBadge}>
              {i} <span onClick={() => remove(i)} style={{ cursor: 'pointer', marginLeft: '4px', fontWeight: 700 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search industries..."
          style={{ ...inputStyle, flex: 1 }} />
        <button type="button" onClick={() => setExpanded(!expanded)} style={addTagBtn}>
          {expanded ? 'Hide' : 'Browse'}
        </button>
      </div>
      {expanded && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', maxHeight: '220px', overflowY: 'auto', padding: '8px' }}>
          {filtered.map(i => (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', cursor: 'pointer', fontSize: '13px' }}>
              <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} />
              {i}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Results Table ──────────────────────────────────────────────────────────────

function ResultsTable({ contacts, selected, onToggle, onSelectAll, onSelectNew, onSelectNone }) {
  const [page, setPage] = useState(1)
  const perPage = 50
  const totalPages = Math.ceil(contacts.length / perPage)
  const pageContacts = contacts.slice((page - 1) * perPage, page * perPage)

  const scoreColor = s => {
    if (!s) return '#718096'
    if (s >= 8) return '#276749'
    if (s >= 6) return '#2b6cb0'
    return '#975a16'
  }

  return (
    <div>
      {/* Selection shortcuts */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: '#4a5568', fontWeight: 500 }}>
          {selected.size} of {contacts.length} selected
        </span>
        <button onClick={onSelectAll} type="button" style={smallBtn}>Select All</button>
        <button onClick={onSelectNew} type="button" style={smallBtn}>New Only ({contacts.filter(c => !c._exists).length})</button>
        <button onClick={onSelectNone} type="button" style={smallBtn}>None</button>
        {totalPages > 1 && (
          <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#718096' }}>
            Page {page} / {totalPages}
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f7fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={th}></th>
              <th style={th}>Name</th>
              <th style={th}>Email</th>
              <th style={th}>Title</th>
              <th style={th}>Company</th>
              <th style={th}>Industry</th>
              <th style={th}>Size</th>
              <th style={th}>Country</th>
              <th style={th}>Score</th>
              <th style={th}>Email Status</th>
              <th style={th}>In DB?</th>
            </tr>
          </thead>
          <tbody>
            {pageContacts.map((c, i) => {
              const key = c.email
              const checked = selected.has(key)
              const rowBg = c._exists ? '#fffbeb' : checked ? '#ebf8ff' : '#fff'
              return (
                <tr key={key} style={{ background: rowBg, borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                  onClick={() => onToggle(key)}>
                  <td style={{ ...td, width: '36px', textAlign: 'center' }}>
                    <input type="checkbox" checked={checked} onChange={() => onToggle(key)}
                      onClick={e => e.stopPropagation()} />
                  </td>
                  <td style={td}>{c.fullName || `${c.firstName} ${c.lastName}`.trim() || '—'}</td>
                  <td style={{ ...td, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()}
                      style={{ color: '#3182ce', textDecoration: 'none' }}>{c.email}</a>
                  </td>
                  <td style={td}>{c.jobTitle || '—'}</td>
                  <td style={{ ...td, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.companyName || '—'}
                  </td>
                  <td style={{ ...td, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
                    {c.industry || '—'}
                  </td>
                  <td style={td}>{c.companySize || '—'}</td>
                  <td style={td}>{c.country || '—'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ fontWeight: 700, color: scoreColor(c.qualScore) }}>
                      {c.qualScore ?? '—'}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: '12px' }}>
                    <span style={{
                      padding: '2px 7px', borderRadius: '10px',
                      background: c.emailStatus === 'validated' ? '#f0fff4' : '#fff5f5',
                      color: c.emailStatus === 'validated' ? '#276749' : '#c53030',
                      border: `1px solid ${c.emailStatus === 'validated' ? '#9ae6b4' : '#feb2b2'}`
                    }}>
                      {c.emailStatus || 'unknown'}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {c._exists
                      ? <span style={{ color: '#975a16', fontSize: '12px', fontWeight: 600 }}>EXISTS</span>
                      : <span style={{ color: '#276749', fontSize: '12px' }}>NEW</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '12px' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            type="button" style={smallBtn}>← Prev</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const p = totalPages <= 7 ? i + 1 :
              page <= 4 ? i + 1 :
              page >= totalPages - 3 ? totalPages - 6 + i :
              page - 3 + i
            return (
              <button key={p} onClick={() => setPage(p)} type="button"
                style={{ ...smallBtn, background: page === p ? '#2d3748' : '#fff', color: page === p ? '#fff' : '#4a5568' }}>
                {p}
              </button>
            )
          })}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            type="button" style={smallBtn}>Next →</button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Apify() {
  const { brandId } = useParams()

  // Config
  const [config, setConfig]     = useState({ actorId: 'IoSHqwTR9YGhzccez', hasToken: false, defaultInput: {} })
  const [apiToken, setApiToken] = useState('')
  const [actorId, setActorId]   = useState('IoSHqwTR9YGhzccez')
  const [mode, setMode]         = useState('form')

  // Actor input fields — EXACT names from actor schema
  const [fetchCount, setFetchCount]                   = useState(100)
  const [fileName, setFileName]                       = useState('')
  const [contactJobTitle, setContactJobTitle]         = useState([])
  const [contactNotJobTitle, setContactNotJobTitle]   = useState([])
  const [seniorityLevel, setSeniorityLevel]           = useState([])
  const [functionalLevel, setFunctionalLevel]         = useState([])
  const [contactLocation, setContactLocation]         = useState([])
  const [contactNotLocation, setContactNotLocation]   = useState([])
  const [contactCity, setContactCity]                 = useState([])
  const [contactNotCity, setContactNotCity]           = useState([])
  const [emailStatus, setEmailStatus]                 = useState(['validated'])
  const [companyDomain, setCompanyDomain]             = useState([])
  const [companySize, setCompanySize]                 = useState([])
  const [companyIndustry, setCompanyIndustry]         = useState([])
  const [companyNotIndustry, setCompanyNotIndustry]   = useState([])
  const [companyKeywords, setCompanyKeywords]         = useState([])
  const [companyNotKeywords, setCompanyNotKeywords]   = useState([])
  const [funding, setFunding]                         = useState([])
  const [minRevenue, setMinRevenue]                   = useState('')
  const [maxRevenue, setMaxRevenue]                   = useState('')

  // UI state
  const [rawJson, setRawJson]     = useState('{}')
  const [jsonError, setJsonError] = useState('')
  const [saving, setSaving]       = useState(false)
  const [saveMsg, setSaveMsg]     = useState('')
  const [running, setRunning]     = useState(false)
  const [runError, setRunError]   = useState('')

  // Two-step flow state
  const [step, setStep]           = useState('form')  // 'form' | 'results'
  const [runStats, setRunStats]   = useState(null)
  const [contacts, setContacts]   = useState([])
  const [selected, setSelected]   = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError]   = useState('')

  useEffect(() => {
    api.get(`/brands/${brandId}/apify/config`).then(r => {
      setConfig(r.data)
      setActorId(r.data.actorId || 'IoSHqwTR9YGhzccez')
      if (r.data.defaultInput && Object.keys(r.data.defaultInput).length) {
        loadSaved(r.data.defaultInput)
      }
    }).catch(() => {})
  }, [brandId])

  function loadSaved(i) {
    if (i.fetch_count)             setFetchCount(Math.min(i.fetch_count, MAX_FETCH))
    if (i.file_name)               setFileName(i.file_name)
    if (i.contact_job_title)       setContactJobTitle(i.contact_job_title)
    if (i.contact_not_job_title)   setContactNotJobTitle(i.contact_not_job_title)
    if (i.seniority_level)         setSeniorityLevel(i.seniority_level)
    if (i.functional_level)        setFunctionalLevel(i.functional_level)
    if (i.contact_location)        setContactLocation(i.contact_location)
    if (i.contact_not_location)    setContactNotLocation(i.contact_not_location)
    if (i.contact_city)            setContactCity(i.contact_city)
    if (i.contact_not_city)        setContactNotCity(i.contact_not_city)
    if (i.email_status)            setEmailStatus(i.email_status)
    if (i.company_domain)          setCompanyDomain(i.company_domain)
    if (i.size)                    setCompanySize(i.size)
    if (i.company_industry)        setCompanyIndustry(i.company_industry)
    if (i.company_not_industry)    setCompanyNotIndustry(i.company_not_industry)
    if (i.company_keywords)        setCompanyKeywords(i.company_keywords)
    if (i.company_not_keywords)    setCompanyNotKeywords(i.company_not_keywords)
    if (i.funding)                 setFunding(i.funding)
    if (i.min_revenue)             setMinRevenue(i.min_revenue)
    if (i.max_revenue)             setMaxRevenue(i.max_revenue)
  }

  function buildInput() {
    if (mode === 'json') {
      try { setJsonError(''); return JSON.parse(rawJson) }
      catch { setJsonError('Invalid JSON'); return null }
    }

    const count = Math.max(1, Math.min(MAX_FETCH, parseInt(fetchCount) || 100))
    const inp = { fetch_count: count }

    if (fileName.trim()) inp.file_name = fileName.trim()

    const arr = (key, val) => { if (val && val.length) inp[key] = val }
    const str = (key, val) => { if (val && val.trim()) inp[key] = val.trim() }

    arr('contact_job_title',     contactJobTitle)
    arr('contact_not_job_title', contactNotJobTitle)
    arr('seniority_level',       seniorityLevel)
    arr('functional_level',      functionalLevel)
    arr('contact_location',      contactLocation)
    arr('contact_not_location',  contactNotLocation)
    arr('contact_city',          contactCity)
    arr('contact_not_city',      contactNotCity)
    arr('email_status',          emailStatus)
    arr('company_domain',        companyDomain)
    arr('size',                  companySize)
    arr('company_industry',      companyIndustry)
    arr('company_not_industry',  companyNotIndustry)
    arr('company_keywords',      companyKeywords)
    arr('company_not_keywords',  companyNotKeywords)
    arr('funding',               funding)
    str('min_revenue',           minRevenue)
    str('max_revenue',           maxRevenue)

    return inp
  }

  function switchMode(m) {
    if (m === 'json') {
      const inp = buildInput()
      if (inp) setRawJson(JSON.stringify(inp, null, 2))
    }
    setMode(m)
  }

  async function saveConfig() {
    setSaving(true); setSaveMsg('')
    try {
      const inp = buildInput()
      await api.put(`/brands/${brandId}/apify/config`, {
        ...(apiToken ? { apiToken } : {}),
        actorId,
        defaultInput: inp || {}
      })
      setSaveMsg('Saved!')
      setTimeout(() => setSaveMsg(''), 2000)
    } catch (e) {
      setSaveMsg('Error: ' + (e.response?.data?.error || e.message))
    }
    setSaving(false)
  }

  async function runActor() {
    const inp = buildInput()
    if (!inp) return
    setRunning(true); setRunError(''); setImportResult(null); setImportError('')
    try {
      const r = await api.post(`/brands/${brandId}/apify/run`, {
        input: inp,
        ...(apiToken ? { apiToken } : {})
      })
      const data = r.data
      setRunStats({ scraped: data.scraped, qualified: data.qualified, existing: data.existing })
      setContacts(data.contacts || [])
      // Auto-select all new contacts
      const newEmails = new Set((data.contacts || []).filter(c => !c._exists).map(c => c.email))
      setSelected(newEmails)
      setStep('results')
    } catch (e) {
      setRunError(e.response?.data?.error || e.message)
    }
    setRunning(false)
  }

  async function importSelected() {
    const toImport = contacts.filter(c => selected.has(c.email))
    if (!toImport.length) return
    setImporting(true); setImportError(''); setImportResult(null)
    try {
      const r = await api.post(`/brands/${brandId}/apify/import`, { contacts: toImport })
      setImportResult(r.data)
    } catch (e) {
      setImportError(e.response?.data?.error || e.message)
    }
    setImporting(false)
  }

  const handleToggle = email => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email); else next.add(email)
      return next
    })
  }

  const handleSelectAll  = () => setSelected(new Set(contacts.map(c => c.email)))
  const handleSelectNew  = () => setSelected(new Set(contacts.filter(c => !c._exists).map(c => c.email)))
  const handleSelectNone = () => setSelected(new Set())

  const effectiveFetch = Math.max(1, Math.min(MAX_FETCH, parseInt(fetchCount) || 100))

  // ── Step 1: Form ─────────────────────────────────────────────────────────────

  if (step === 'form') {
    return (
      <div style={{ padding: '24px', maxWidth: '960px' }}>
        <h2 style={{ marginBottom: '4px' }}>Apify Lead Scraper</h2>
        <p style={{ color: '#666', marginBottom: '4px', fontSize: '14px' }}>
          Actor: <code style={codeStyle}>{actorId}</code> — Leads Finder (Apollo Alternative)
        </p>
        <p style={{ color: '#e53e3e', fontSize: '13px', marginBottom: '20px', background: '#fff5f5', padding: '8px 12px', borderRadius: '6px', border: '1px solid #feb2b2' }}>
          <strong>fetch_count is required</strong> — always set it before running or the actor will run until timeout (50 mins) and consume all credits.
          Maximum allowed: <strong>1,000 leads per run</strong>.
        </p>

        {/* Credentials */}
        <section style={sectionStyle}>
          <h3 style={sectionTitle}>API Credentials</h3>
          <div style={row}>
            <div style={field}>
              <label style={labelStyle}>Apify API Token</label>
              <input type="password" value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder={config.hasToken ? '••••••••  (token saved)' : 'apify_api_...'}
                style={inputStyle} />
              <small style={{ color: '#888' }}>Leave blank to use saved token. Never committed to git.</small>
            </div>
            <div style={{ ...field, maxWidth: '280px' }}>
              <label style={labelStyle}>Actor ID</label>
              <input value={actorId} onChange={e => setActorId(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </section>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {[['form', 'Filter Form'], ['json', 'Raw JSON']].map(([m, label]) => (
            <button key={m} onClick={() => switchMode(m)} type="button"
              style={mode === m ? activeTabStyle : tabStyle}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'form' && (
          <>
            {/* Volume */}
            <section style={sectionStyle}>
              <h3 style={sectionTitle}>Volume & Run Settings</h3>
              <div style={row}>
                <div style={{ ...field, maxWidth: '200px' }}>
                  <label style={{ ...labelStyle, color: '#e53e3e' }}>
                    fetch_count <span style={{ fontWeight: 700 }}>*required*</span>
                  </label>
                  <input type="number" value={fetchCount}
                    onChange={e => setFetchCount(e.target.value)}
                    style={{ ...inputStyle, border: `2px solid ${parseInt(fetchCount) > MAX_FETCH ? '#e53e3e' : '#e2e8f0'}`, fontWeight: 600 }}
                    min={1} max={MAX_FETCH} />
                  <small style={{ color: parseInt(fetchCount) > MAX_FETCH ? '#e53e3e' : '#718096' }}>
                    Max {MAX_FETCH} per run
                    {parseInt(fetchCount) > MAX_FETCH && ` — will be clamped to ${MAX_FETCH}`}
                  </small>
                </div>
                <div style={field}>
                  <label style={labelStyle}>file_name / Run Label <small style={{ color: '#aaa' }}>(optional)</small></label>
                  <input value={fileName} onChange={e => setFileName(e.target.value)}
                    placeholder="e.g. usa-saas-ctc-april" style={inputStyle} />
                </div>
                <div style={field}>
                  <label style={labelStyle}>email_status</label>
                  <MultiChip options={EMAIL_STATUS} selected={emailStatus} onChange={setEmailStatus} />
                </div>
              </div>
            </section>

            {/* Job Title */}
            <section style={sectionStyle}>
              <h3 style={sectionTitle}>Job Title</h3>
              <div style={row}>
                <div style={field}>
                  <label style={labelStyle}>contact_job_title — Include</label>
                  <TagInput value={contactJobTitle} onChange={setContactJobTitle}
                    placeholder='"CTO", "VP Engineering", "Head of QA"' />
                </div>
                <div style={field}>
                  <label style={labelStyle}>contact_not_job_title — Exclude</label>
                  <TagInput value={contactNotJobTitle} onChange={setContactNotJobTitle}
                    placeholder='"intern", "student"' />
                </div>
              </div>
              <div style={{ ...field, marginTop: '4px' }}>
                <label style={labelStyle}>seniority_level</label>
                <MultiChip options={SENIORITY_LEVEL} selected={seniorityLevel} onChange={setSeniorityLevel} />
              </div>
              <div style={field}>
                <label style={labelStyle}>functional_level</label>
                <MultiChip options={FUNCTIONAL_LEVEL} selected={functionalLevel} onChange={setFunctionalLevel} />
              </div>
            </section>

            {/* Location */}
            <section style={sectionStyle}>
              <h3 style={sectionTitle}>Location</h3>
              <p style={{ fontSize: '12px', color: '#718096', marginBottom: '12px', background: '#fffbeb', padding: '8px', borderRadius: '6px' }}>
                Tip: Use <strong>contact_location</strong> for region/country/state.
                Use <strong>contact_city</strong> for specific cities. Don't mix regions + cities in the same run.
              </p>
              <div style={row}>
                <div style={field}>
                  <label style={labelStyle}>contact_location — Include (Region/Country/State)</label>
                  <TagInput value={contactLocation} onChange={setContactLocation}
                    placeholder='"united states", "germany", "california, us"' />
                </div>
                <div style={field}>
                  <label style={labelStyle}>contact_not_location — Exclude</label>
                  <TagInput value={contactNotLocation} onChange={setContactNotLocation}
                    placeholder='"india", "russia", "china"' />
                </div>
              </div>
              <div style={row}>
                <div style={field}>
                  <label style={labelStyle}>contact_city — Include cities</label>
                  <TagInput value={contactCity} onChange={setContactCity}
                    placeholder='"new york", "san francisco"' />
                </div>
                <div style={field}>
                  <label style={labelStyle}>contact_not_city — Exclude cities</label>
                  <TagInput value={contactNotCity} onChange={setContactNotCity}
                    placeholder='"karachi"' />
                </div>
              </div>
            </section>

            {/* Company */}
            <section style={sectionStyle}>
              <h3 style={sectionTitle}>Company</h3>
              <div style={field}>
                <label style={labelStyle}>size — Company Size (employees)</label>
                <MultiChip options={COMPANY_SIZE} selected={companySize} onChange={setCompanySize} />
              </div>
              <div style={field}>
                <label style={labelStyle}>company_domain — Target specific domains</label>
                <TagInput value={companyDomain} onChange={setCompanyDomain}
                  placeholder='"google.com", "apple.com"' />
              </div>
              <div style={row}>
                <div style={field}>
                  <label style={labelStyle}>company_keywords — Include</label>
                  <TagInput value={companyKeywords} onChange={setCompanyKeywords}
                    placeholder='"software development", "QA", "DevOps"' />
                </div>
                <div style={field}>
                  <label style={labelStyle}>company_not_keywords — Exclude</label>
                  <TagInput value={companyNotKeywords} onChange={setCompanyNotKeywords}
                    placeholder='"outsourcing", "agency"' />
                </div>
              </div>
              <div style={row}>
                <IndustryPicker label="company_industry — Include industries"
                  selected={companyIndustry} onChange={setCompanyIndustry} />
                <IndustryPicker label="company_not_industry — Exclude industries"
                  selected={companyNotIndustry} onChange={setCompanyNotIndustry} />
              </div>
            </section>

            {/* Funding & Revenue */}
            <section style={sectionStyle}>
              <h3 style={sectionTitle}>Funding & Revenue</h3>
              <div style={field}>
                <label style={labelStyle}>funding</label>
                <MultiChip options={FUNDING} selected={funding} onChange={setFunding} />
              </div>
              <div style={row}>
                <div style={{ ...field, maxWidth: '200px' }}>
                  <label style={labelStyle}>min_revenue</label>
                  <select value={minRevenue} onChange={e => setMinRevenue(e.target.value)} style={inputStyle}>
                    {REVENUE_OPTIONS.map(v => (
                      <option key={v} value={v}>{v || '— no minimum —'}</option>
                    ))}
                  </select>
                </div>
                <div style={{ ...field, maxWidth: '200px' }}>
                  <label style={labelStyle}>max_revenue</label>
                  <select value={maxRevenue} onChange={e => setMaxRevenue(e.target.value)} style={inputStyle}>
                    {REVENUE_OPTIONS.map(v => (
                      <option key={v} value={v}>{v || '— no maximum —'}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>
          </>
        )}

        {mode === 'json' && (
          <section style={sectionStyle}>
            <h3 style={sectionTitle}>Raw JSON Input</h3>
            <p style={{ fontSize: '13px', color: '#718096', marginBottom: '8px' }}>
              Switch from Form to auto-fill from current values.
              <strong style={{ color: '#e53e3e' }}> fetch_count is mandatory. Max {MAX_FETCH}.</strong>
            </p>
            <textarea value={rawJson}
              onChange={e => { setRawJson(e.target.value); setJsonError('') }}
              style={{
                width: '100%', minHeight: '340px', fontFamily: 'monospace', fontSize: '13px',
                padding: '12px', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                border: jsonError ? '2px solid #e53e3e' : '1px solid #e2e8f0', borderRadius: '6px'
              }}
              spellCheck={false} />
            {jsonError && <p style={{ color: '#e53e3e', fontSize: '13px', margin: '4px 0 0' }}>{jsonError}</p>}
          </section>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
          <button onClick={saveConfig} disabled={saving} type="button" style={secondaryBtn}>
            {saving ? 'Saving...' : 'Save as Default'}
          </button>
          <button onClick={runActor} disabled={running} type="button" style={primaryBtn}>
            {running ? '⏳ Running actor...' : `▶ Fetch ${effectiveFetch} Leads`}
          </button>
          {saveMsg && (
            <span style={{ fontSize: '13px', color: saveMsg.startsWith('Error') ? '#e53e3e' : '#38a169' }}>
              {saveMsg}
            </span>
          )}
        </div>

        {running && (
          <div style={{ marginTop: '20px', padding: '14px 16px', background: '#fffbeb', border: '1px solid #f6e05e', borderRadius: '8px', fontSize: '14px' }}>
            ⏳ Apify actor is running — fetching up to {effectiveFetch} leads. This takes 1–5 minutes. Do not close this page.
          </div>
        )}

        {runError && (
          <div style={{ marginTop: '16px', padding: '14px', background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: '8px', color: '#c53030', fontSize: '14px' }}>
            <strong>Error:</strong> {runError}
          </div>
        )}
      </div>
    )
  }

  // ── Step 2: Results ───────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button onClick={() => setStep('form')} type="button" style={secondaryBtn}>
          ← Back to Filters
        </button>
        <h2 style={{ margin: 0 }}>Apify Results</h2>
      </div>

      {/* Run stats */}
      {runStats && (
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '20px', padding: '16px 20px', background: '#f7fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <Stat label="Scraped by Apify"    value={runStats.scraped} />
          <Stat label="Passed qualification" value={runStats.qualified} color="#2b6cb0" bold />
          <Stat label="Already in DB"        value={runStats.existing} color="#975a16" />
          <Stat label="New leads"            value={runStats.qualified - runStats.existing} color="#276749" bold />
        </div>
      )}

      {contacts.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#718096', background: '#f7fafc', borderRadius: '8px' }}>
          No qualified contacts returned from this run.
        </div>
      ) : (
        <>
          <ResultsTable
            contacts={contacts}
            selected={selected}
            onToggle={handleToggle}
            onSelectAll={handleSelectAll}
            onSelectNew={handleSelectNew}
            onSelectNone={handleSelectNone}
          />

          {/* Import bar */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px', padding: '16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={importSelected}
              disabled={importing || selected.size === 0}
              type="button"
              style={{ ...primaryBtn, opacity: selected.size === 0 ? 0.5 : 1 }}>
              {importing ? '⏳ Importing...' : `Import Selected (${selected.size})`}
            </button>
            <span style={{ fontSize: '13px', color: '#718096' }}>
              {selected.size === 0
                ? 'Select contacts above to import'
                : `${contacts.filter(c => selected.has(c.email) && !c._exists).length} new + ${contacts.filter(c => selected.has(c.email) && c._exists).length} already in DB`
              }
            </span>

            {importResult && (
              <div style={{ marginLeft: 'auto', padding: '8px 14px', background: '#f0fff4', border: '1px solid #9ae6b4', borderRadius: '6px', fontSize: '13px' }}>
                <strong style={{ color: '#276749' }}>Imported {importResult.imported} contacts.</strong>
                {importResult.duplicatesSkipped > 0 && ` ${importResult.duplicatesSkipped} duplicates skipped.`}
                {importResult.message && ` ${importResult.message}`}
              </div>
            )}
            {importError && (
              <div style={{ marginLeft: 'auto', padding: '8px 14px', background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: '6px', color: '#c53030', fontSize: '13px' }}>
                <strong>Import failed:</strong> {importError}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color, bold }) {
  return (
    <div style={{ textAlign: 'center', minWidth: '80px' }}>
      <div style={{ fontSize: '28px', fontWeight: bold ? 700 : 600, color: color || '#2d3748' }}>{value ?? '—'}</div>
      <div style={{ fontSize: '11px', color: '#718096', marginTop: '2px' }}>{label}</div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sectionStyle   = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '20px', marginBottom: '16px' }
const sectionTitle   = { fontSize: '15px', fontWeight: 600, marginBottom: '14px', color: '#2d3748' }
const row            = { display: 'flex', gap: '16px', flexWrap: 'wrap' }
const field          = { flex: 1, minWidth: '220px', marginBottom: '14px' }
const labelStyle     = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '5px', color: '#4a5568' }
const inputStyle     = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }
const chip           = { padding: '4px 10px', border: '1px solid #e2e8f0', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', background: '#f7fafc', color: '#4a5568' }
const chipActive     = { ...chip, background: '#3182ce', color: '#fff', borderColor: '#3182ce' }
const tagBadge       = { display: 'inline-flex', alignItems: 'center', padding: '3px 8px', background: '#ebf8ff', color: '#2b6cb0', borderRadius: '4px', fontSize: '12px', border: '1px solid #bee3f8' }
const addTagBtn      = { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', background: '#f7fafc', fontSize: '13px', whiteSpace: 'nowrap' }
const primaryBtn     = { padding: '9px 20px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }
const secondaryBtn   = { padding: '9px 16px', background: '#fff', color: '#3182ce', border: '1px solid #3182ce', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }
const tabStyle       = { padding: '7px 16px', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', background: '#fff', fontSize: '13px', color: '#666' }
const activeTabStyle = { ...tabStyle, background: '#2d3748', color: '#fff', borderColor: '#2d3748' }
const codeStyle      = { background: '#f0f4f8', padding: '2px 6px', borderRadius: '4px', fontSize: '13px' }
const th             = { padding: '10px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#4a5568', whiteSpace: 'nowrap' }
const td             = { padding: '8px 12px', color: '#2d3748' }
const smallBtn       = { padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: '5px', cursor: 'pointer', background: '#fff', fontSize: '12px', color: '#4a5568' }
