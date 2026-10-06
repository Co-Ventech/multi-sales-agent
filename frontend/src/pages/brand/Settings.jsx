import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import apiClient from '../../api/client'

const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fff', transition: 'border 0.15s', boxSizing: 'border-box' }
const labelStyle = { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '700', color: '#555', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.5px' }
const fieldStyle = { marginBottom: '16px' }
const sectionStyle = { background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', marginBottom: '18px', border: '1px solid #f0f0f0' }
const sectionHead = { fontSize: '13px', fontWeight: '700', color: '#1a1a2e', marginBottom: '18px', paddingBottom: '10px', borderBottom: '1px solid #f4f4f4', display: 'flex', alignItems: 'center', gap: '8px' }

const OPENAI_MODELS = [
  // GPT-4.1 family (Apr 14, 2025) — best for text generation
  { value: 'gpt-4.1',           label: 'GPT-4.1 — Best quality · Apr 2025' },
  { value: 'gpt-4.1-mini',      label: 'GPT-4.1 Mini — Fast & affordable ★ Recommended' },
  { value: 'gpt-4.1-nano',      label: 'GPT-4.1 Nano — Fastest & cheapest' },
  // Reasoning models (good quality but slower for email)
  { value: 'o4-mini',           label: 'o4-mini — Reasoning model · Apr 2025' },
  { value: 'o3',                label: 'o3 — Advanced reasoning · Apr 2025' },
  { value: 'o3-mini',           label: 'o3-mini — Compact reasoning' },
  // GPT-4o family (stable, widely used)
  { value: 'gpt-4o',            label: 'GPT-4o — Reliable, proven · 2024' },
  { value: 'gpt-4o-mini',       label: 'GPT-4o Mini — Budget option' },
]

const SPAM_WORDS = [
  'act now', 'act immediately', 'apply now', 'limited time', 'now or never', 'today only',
  'don\'t hesitate', 'don\'t delay', 'make money', 'earn extra', 'extra cash', 'financial freedom',
  'cash bonus', 'no cost', 'no fees', 'free money', 'risk free', 'risk-free', 'no risk',
  'double your', 'triple your', 'amazing offer', 'incredible deal', 'unbelievable',
  'satisfaction guaranteed', 'you\'ve been selected', 'exclusive deal', 'special promotion',
  'special offer', 'once in a lifetime', 'buy now', 'click here', 'click below',
  'subscribe now', 'you have won', 'congratulations', 'dear friend',
  'i hope this email finds you well', 'i hope this finds you well', 'hope you\'re doing well',
  'just following up', 'just checking in', 'touching base', 'circling back', 'per my last email',
]
const SPAM_PATTERNS = ['ALL-CAPS words (5+ letters)', 'Multiple !!! or ???', 'Dollar amounts ($100)', 'Percentage discounts (50% off)']

const SCHEDULE_HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? '12:00 AM (midnight)' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM (noon)' : `${i - 12}:00 PM`
}))

const DAYS_OPTIONS = [
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)', cron: '1-5' },
  { value: 'everyday', label: 'Every day', cron: '*' },
  { value: 'mon-wed-fri', label: 'Mon, Wed & Fri only', cron: '1,3,5' },
  { value: 'sun-thu', label: 'Sun–Thu (Middle East week)', cron: '0-4' },
  { value: 'tue-sat', label: 'Tue–Sat', cron: '2-6' },
]

const SCRAPE_FREQS = [
  { value: 'monthly_1st', label: 'Monthly — 1st of every month' },
  { value: 'weekly_mon',  label: 'Weekly — every Monday' },
  { value: 'daily',       label: 'Daily' },
  { value: 'disabled',    label: 'Disabled (manual only)' }
]

function parseScrapeCron(cron) {
  if (!cron) return { freq: 'disabled', hour: 9, minute: 0 }
  let m
  if ((m = cron.match(/^(\d+) (\d+) 1 \* \*$/))) return { freq: 'monthly_1st', hour: parseInt(m[2]), minute: parseInt(m[1]) }
  if ((m = cron.match(/^(\d+) (\d+) \* \* 1$/))) return { freq: 'weekly_mon',  hour: parseInt(m[2]), minute: parseInt(m[1]) }
  if ((m = cron.match(/^(\d+) (\d+) \* \* \*$/))) return { freq: 'daily',      hour: parseInt(m[2]), minute: parseInt(m[1]) }
  // One-shot test cron: "M H D Mo *"
  if ((m = cron.match(/^(\d+) (\d+) (\d+) (\d+) \*$/))) return { freq: 'one_shot', hour: parseInt(m[2]), minute: parseInt(m[1]), day: parseInt(m[3]), month: parseInt(m[4]) }
  return { freq: 'disabled', hour: 9, minute: 0 }
}

function toScrapeCron(freq, hour, minute, day, month) {
  const h = parseInt(hour); const min = parseInt(minute) || 0
  const hh = isNaN(h) ? 9 : h
  if (freq === 'monthly_1st') return `${min} ${hh} 1 * *`
  if (freq === 'weekly_mon')  return `${min} ${hh} * * 1`
  if (freq === 'daily')       return `${min} ${hh} * * *`
  if (freq === 'one_shot' && day && month) return `${min} ${hh} ${day} ${month} *`
  return ''
}

const COMMON_TIMEZONES = [
  { value: 'America/New_York',    label: 'America/New York (Eastern)' },
  { value: 'America/Chicago',     label: 'America/Chicago (Central)' },
  { value: 'America/Denver',      label: 'America/Denver (Mountain)' },
  { value: 'America/Los_Angeles', label: 'America/Los Angeles (Pacific)' },
  { value: 'Asia/Karachi',        label: 'Asia/Karachi (Pakistan)' },
  { value: 'Asia/Dubai',          label: 'Asia/Dubai (UAE)' },
  { value: 'Europe/London',       label: 'Europe/London (UK)' },
  { value: 'UTC',                 label: 'UTC' }
]

const BOUNCE_FREQS = [
  { value: 'every_15min', label: 'Every 15 minutes' },
  { value: 'every_30min', label: 'Every 30 minutes' },
  { value: 'every_hour', label: 'Every hour' },
  { value: 'every_2hours', label: 'Every 2 hours' },
  { value: 'every_6hours', label: 'Every 6 hours' },
  { value: 'daily', label: 'Once a day (pick a time below)' },
]

function parseGenSendCron(cron) {
  if (!cron) return { hour: 9, days: 'weekdays' }
  const p = cron.trim().split(/\s+/)
  if (p.length !== 5) return { hour: 9, days: 'weekdays' }
  const h = parseInt(p[1])
  const dow = p[4]
  let days = 'weekdays'
  if (dow === '*') days = 'everyday'
  else if (dow === '1-5') days = 'weekdays'
  else if (dow === '1,3,5') days = 'mon-wed-fri'
  else if (dow === '0-4') days = 'sun-thu'
  else if (dow === '2-6') days = 'tue-sat'
  return { hour: isNaN(h) ? 9 : h, days }
}

function parseBouncesCron(cron) {
  if (!cron) return { freq: 'every_hour', hour: 11 }
  if (cron === '*/15 * * * *') return { freq: 'every_15min', hour: 11 }
  if (cron === '*/30 * * * *') return { freq: 'every_30min', hour: 11 }
  if (cron === '0 * * * *') return { freq: 'every_hour', hour: 11 }
  if (cron.startsWith('0 */2')) return { freq: 'every_2hours', hour: 11 }
  if (cron.startsWith('0 */6')) return { freq: 'every_6hours', hour: 11 }
  const m = cron.match(/^0 (\d+) \* \* \*$/)
  if (m) return { freq: 'daily', hour: parseInt(m[1]) }
  return { freq: 'every_hour', hour: 11 }
}

function toGenSendCron(hour, days) {
  const d = { weekdays: '1-5', everyday: '*', 'mon-wed-fri': '1,3,5', 'sun-thu': '0-4', 'tue-sat': '2-6' }
  return `0 ${hour} * * ${d[days] || '1-5'}`
}

function toBounceCron(freq, hour) {
  const map = {
    every_15min: '*/15 * * * *', every_30min: '*/30 * * * *',
    every_hour: '0 * * * *', every_2hours: '0 */2 * * *',
    every_6hours: '0 */6 * * *', daily: `0 ${hour} * * *`
  }
  return map[freq] || '0 * * * *'
}

// ── Info Tooltip ───────────────────────────────────────────────────────────────
function Info({ children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid #aaa', background: open ? '#1a1a2e' : '#f5f5f5', color: open ? '#fff' : '#666', fontSize: '10px', fontWeight: '700', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >i</button>
      {open && (
        <div style={{
          position: 'absolute', top: '22px', left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a2e', color: '#e8e8e8', borderRadius: '8px', padding: '10px 14px',
          fontSize: '12px', lineHeight: '1.6', zIndex: 999, width: '280px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)', whiteSpace: 'normal'
        }}>
          <div style={{ position: 'absolute', top: '-5px', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '5px solid #1a1a2e' }} />
          {children}
        </div>
      )}
    </span>
  )
}

// ── Toggle ─────────────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange, label, hint, info }) => (
  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '14px' }}>
    <div
      style={{ width: '40px', height: '22px', borderRadius: '11px', background: checked ? '#0f3460' : '#d0d0d0', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0, marginTop: '1px' }}
      onClick={onChange}
    >
      <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px', left: checked ? '20px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: '13px', fontWeight: '600', color: '#222', display: 'flex', alignItems: 'center', gap: '6px' }}>
        {label}
        {info && <Info>{info}</Info>}
      </div>
      {hint && <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>{hint}</div>}
    </div>
  </label>
)

// ── Label with Info ────────────────────────────────────────────────────────────
function Label({ children, info }) {
  return (
    <div style={labelStyle}>
      {children}
      {info && <Info>{info}</Info>}
    </div>
  )
}

// Upload-batch list with pause/resume toggles. Section in Settings page.
function UploadBatchesSection({ brandId }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiClient.get(`/brands/${brandId}/contacts/import-batches`)
      setBatches(res.data || [])
    } catch (e) {
      // ignore — endpoint may not exist on first load
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [brandId])

  const togglePaused = async (batch) => {
    const next = !batch.paused
    try {
      await apiClient.patch(`/brands/${brandId}/contacts/import-batches/${batch._id}`, { paused: next })
      setBatches(prev => prev.map(b => b._id === batch._id ? { ...b, paused: next } : b))
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to toggle')
    }
  }

  if (loading) return <div style={{ fontSize: '12px', color: '#888' }}>Loading batches...</div>
  if (!batches.length) return <div style={{ fontSize: '12px', color: '#888' }}>No upload batches yet. Imported files will appear here so you can pause/resume sending per file.</div>

  return (
    <div>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px' }}>
        Toggle off to <strong>pause sending</strong> to contacts from that file. Other operations (generate, follow-up, bounce check) continue normally.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {batches.map(b => {
          const sent = b.live?.byStatus?.Sent || 0
          const pending = (b.live?.byStatus?.Pending || 0) + (b.live?.byStatus?.Generated || 0)
          const total = b.live?.total || b.initialCount || 0
          const ago = (() => {
            const d = new Date(b.createdAt)
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          })()
          return (
            <div key={b._id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: b.paused ? '#fff5f5' : '#f8f9ff', border: `1px solid ${b.paused ? '#ffd5d5' : '#e8ecff'}`, borderRadius: '8px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                  {total} contacts · {sent} sent · {pending} ready · {b.source} · {ago}
                </div>
              </div>
              <button
                type="button"
                onClick={() => togglePaused(b)}
                style={{
                  padding: '5px 14px', borderRadius: '6px', border: 'none',
                  background: b.paused ? '#dc3545' : '#198754', color: '#fff',
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer', minWidth: '90px'
                }}>
                {b.paused ? '⏸ Paused' : '▶ Active'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Settings() {
  const { brandId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [form, setForm] = useState({
    name: '',
    company_name: '', company_description: '', company_website: '',
    openai_systemPrompt: '',
    openai_model: 'gpt-4.1-mini', openai_temperature: 0.75, openai_maxTokens: 400,
    qualification_threshold: 6,
    campaign_dailyLimit: 20,
    campaign_delayMinSec: 50, campaign_delayMaxSec: 90,
    campaign_calendlyUrl: '',
    campaign_followUpDay: 6,
    campaign_followUpPrompt: '',
    campaign_followUpsEnabled: true,
    campaign_timezoneFilter: true, campaign_spamFilter: true,
    cron_enabled: false,
    cron_generate_hour: 5, cron_generate_days: 'weekdays',
    cron_send_hour: 9, cron_send_days: 'weekdays',
    cron_followup_hour: 10, cron_followup_days: 'weekdays',
    cron_bounces_freq: 'every_hour', cron_bounces_hour: 11,
    cron_timezone: 'America/New_York',
    cron_scrape_freq: 'monthly_1st', cron_scrape_hour: 9, cron_scrape_minute: 0,
    cron_scrape_day: 1, cron_scrape_month: new Date().getMonth() + 1,
    cron_scrape_timezone: 'Asia/Karachi',
    apify_fetch_count: 100,
    slack_enabled: false, slack_webhookUrl: '', slack_notifyOnReply: true, slack_notifyOnBounce: false,
    notify_replyEmail: '', notify_bounceEmail: ''
  })

  useEffect(() => {
    apiClient.get(`/brands/${brandId}`)
      .then(res => {
        const b = res.data
        setForm({
          name: b.name || '',
          company_name: b.company?.name || '',
          company_description: b.company?.description || '',
          company_website: b.company?.website || '',
          openai_systemPrompt: b.openai?.systemPrompt || '',
          openai_model: b.openai?.model || 'gpt-4.1-mini',
          openai_temperature: b.openai?.temperature ?? 0.75,
          openai_maxTokens: b.openai?.maxTokens ?? 400,
          qualification_threshold: b.qualification?.threshold ?? 6,
          campaign_dailyLimit: b.campaign?.dailyLimit ?? 20,
          campaign_delayMinSec: b.campaign?.delayMinSec ?? 50,
          campaign_calendlyUrl: b.campaign?.calendlyUrl || '',
          campaign_followUpDay: (b.campaign?.followUpDays && b.campaign.followUpDays[0]) || 6,
          campaign_followUpPrompt: b.campaign?.followUpPrompt || '',
          campaign_followUpsEnabled: b.campaign?.followUpsEnabled ?? true,
          campaign_delayMaxSec: b.campaign?.delayMaxSec ?? 20,
          campaign_timezoneFilter: b.campaign?.timezoneFilter ?? true,
          campaign_spamFilter: b.campaign?.spamFilter ?? true,
          cron_enabled: b.cron?.enabled || false,
          ...(() => {
            const gen = parseGenSendCron(b.cron?.generateEmails)
            const send = parseGenSendCron(b.cron?.sendEmails)
            const fup = parseGenSendCron(b.cron?.sendFollowups)
            const bounces = parseBouncesCron(b.cron?.checkBounces)
            return {
              cron_generate_hour: gen.hour, cron_generate_days: gen.days,
              cron_send_hour: send.hour, cron_send_days: send.days,
              cron_followup_hour: fup.hour, cron_followup_days: fup.days,
              cron_bounces_freq: bounces.freq, cron_bounces_hour: bounces.hour
            }
          })(),
          cron_timezone: b.cron?.timezone || 'America/New_York',
          cron_scrape_timezone: b.cron?.scrapeTimezone || 'Asia/Karachi',
          ...(() => {
            const s = parseScrapeCron(b.cron?.scrapeLeads)
            return {
              cron_scrape_freq: s.freq,
              cron_scrape_hour: s.hour,
              cron_scrape_minute: s.minute || 0,
              cron_scrape_day: s.day || 1,
              cron_scrape_month: s.month || (new Date().getMonth() + 1)
            }
          })(),
          apify_fetch_count: (b.apify?.defaultInput?.fetch_count) || 100,
          slack_enabled: b.slack?.enabled || false,
          slack_webhookUrl: b.slack?.webhookUrl || '',
          slack_notifyOnReply: b.slack?.notifyOnReply ?? true,
          slack_notifyOnBounce: b.slack?.notifyOnBounce ?? false,
          notify_replyEmail: b.notifications?.replyNotifyEmail || '',
          notify_bounceEmail: b.notifications?.bounceNotifyEmail || ''
        })
      })
      .finally(() => setLoading(false))
  }, [brandId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await apiClient.put(`/brands/${brandId}`, {
        name: form.name,
        company: { name: form.company_name, description: form.company_description, website: form.company_website },
        openai: { systemPrompt: form.openai_systemPrompt, model: form.openai_model, temperature: parseFloat(form.openai_temperature), maxTokens: parseInt(form.openai_maxTokens) },
        qualification: { threshold: parseInt(form.qualification_threshold) },
        campaign: { dailyLimit: parseInt(form.campaign_dailyLimit), delayMinSec: parseInt(form.campaign_delayMinSec), delayMaxSec: parseInt(form.campaign_delayMaxSec), timezoneFilter: form.campaign_timezoneFilter, spamFilter: form.campaign_spamFilter, calendlyUrl: form.campaign_calendlyUrl.trim(), followUpDays: [parseInt(form.campaign_followUpDay) || 6], followUpPrompt: form.campaign_followUpPrompt, followUpsEnabled: form.campaign_followUpsEnabled },
        cron: {
          enabled: form.cron_enabled,
          generateEmails: toGenSendCron(form.cron_generate_hour, form.cron_generate_days),
          sendEmails: toGenSendCron(form.cron_send_hour, form.cron_send_days),
          sendFollowups: toGenSendCron(form.cron_followup_hour, form.cron_followup_days),
          checkBounces: toBounceCron(form.cron_bounces_freq, form.cron_bounces_hour),
          scrapeLeads: toScrapeCron(form.cron_scrape_freq, form.cron_scrape_hour, form.cron_scrape_minute, form.cron_scrape_day, form.cron_scrape_month),
          timezone: form.cron_timezone,
          scrapeTimezone: form.cron_scrape_timezone
        },
        apify: { fetchCount: parseInt(form.apify_fetch_count) || 100 },
        slack: { enabled: form.slack_enabled, webhookUrl: form.slack_webhookUrl, notifyOnReply: form.slack_notifyOnReply, notifyOnBounce: form.slack_notifyOnBounce },
        notifications: { replyNotifyEmail: form.notify_replyEmail, bounceNotifyEmail: form.notify_bounceEmail }
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const input = window.prompt('Type the brand name to confirm deletion:')
    if (!input || input !== form.name) return alert('Brand name did not match. Deletion cancelled.')
    setDeleting(true)
    try {
      await apiClient.delete(`/brands/${brandId}`)
      navigate('/')
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
      setDeleting(false)
    }
  }

  if (loading) return <div style={{ padding: '40px', color: '#888', textAlign: 'center' }}>Loading settings...</div>

  return (
    <div style={{ maxWidth: '780px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e', margin: 0 }}>Settings</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" onClick={handleDelete} disabled={deleting} style={{ padding: '8px 18px', borderRadius: '8px', border: '1px solid #dc3545', background: '#fff', color: '#dc3545', cursor: deleting ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '500' }}>
            {deleting ? 'Deleting...' : 'Delete Brand'}
          </button>
          <button form="settings-form" type="submit" disabled={saving} style={{ padding: '8px 22px', borderRadius: '8px', border: 'none', background: saved ? '#198754' : '#0f3460', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '600', transition: 'background 0.2s' }}>
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Settings'}
          </button>
        </div>
      </div>

      <form id="settings-form" onSubmit={handleSave}>

        {/* Brand & Company */}
        <div style={sectionStyle}>
          <div style={sectionHead}>🏢 Brand & Company</div>
          <div style={fieldStyle}>
            <Label info="The display name for this brand in the sidebar. Used internally only.">Brand Name *</Label>
            <input required value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={fieldStyle}>
              <Label info="Company name referenced in the AI system prompt for email personalization.">Company Name</Label>
              <input value={form.company_name} onChange={e => set('company_name', e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <Label info="Company website. Can be referenced in the AI prompt.">Website</Label>
              <input type="url" value={form.company_website} onChange={e => set('company_website', e.target.value)} style={inputStyle} placeholder="https://" />
            </div>
          </div>
          <div style={fieldStyle}>
            <Label info="Short description of what the company does. Referenced by AI when generating emails.">Company Description</Label>
            <textarea value={form.company_description} onChange={e => set('company_description', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        {/* AI System Prompt */}
        <div style={sectionStyle}>
          <div style={sectionHead}>🤖 AI System Prompt</div>
          <div style={{ background: '#f0f4ff', border: '1px solid #d0deff', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px', fontSize: '12px', color: '#3a4a7a', lineHeight: '1.7' }}>
            <strong>What to include:</strong> your tone · CTA (e.g. "Worth a quick call?") · value proposition · Calendly link · 2–3 case studies with real metrics · writing rules (word limit, no links, no buzzwords)
          </div>
          <div style={fieldStyle}>
            <textarea
              value={form.openai_systemPrompt}
              onChange={e => set('openai_systemPrompt', e.target.value)}
              rows={16}
              placeholder={`You are a cold email copywriter for [Company].\n\nValue prop: We help SaaS teams cut QA costs by 60%.\nTone: Direct, conversational, no buzzwords.\nCTA: End with "Worth a quick call?"\nCalendly: https://calendly.com/yourname/15min\n\nRules:\n- Under 80 words\n- Open with a specific detail about their company\n- One case study with a real metric\n- No links in body\n- No greetings like "I hope this finds you well"`}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.65', minHeight: '280px' }}
            />
            <small style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', display: 'block' }}>{form.openai_systemPrompt.length} characters</small>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
            <div style={fieldStyle}>
              <Label info={<>The OpenAI model used to write emails.<br /><br /><strong>GPT-4.1 Mini</strong> — best balance for cold email (recommended)<br /><strong>GPT-4.1</strong> — highest quality, slightly slower<br /><strong>GPT-4.1 Nano</strong> — fastest, cheapest, still good<br /><strong>o4-mini / o3</strong> — reasoning models, overkill for emails<br /><strong>GPT-4o</strong> — older but reliable<br /><br />For cold outreach, <strong>GPT-4.1 Mini</strong> gives the best quality-to-cost ratio.</>}>Model</Label>
              <select value={form.openai_model} onChange={e => set('openai_model', e.target.value)} style={inputStyle}>
                {OPENAI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div style={fieldStyle}>
              <Label info={<>Controls how creative vs. predictable the AI output is.<br /><br /><strong>0.0–0.3</strong> — very consistent, safe<br /><strong>0.5–0.8</strong> — good variation (recommended)<br /><strong>1.0–2.0</strong> — very creative, may go off-script<br /><br />For cold emails, 0.6–0.8 works best.</>}>Temperature</Label>
              <input type="number" step="0.05" min={0} max={2} value={form.openai_temperature} onChange={e => set('openai_temperature', e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <Label info={<>Max length of the generated email in tokens.<br /><br />1 token ≈ 0.75 words.<br /><strong>200–300</strong> — short, punchy emails (recommended for cold outreach)<br /><strong>400–600</strong> — medium length<br /><br />Cold emails under 100 words get higher reply rates.</>}>Max Tokens</Label>
              <input type="number" min={100} max={2000} value={form.openai_maxTokens} onChange={e => set('openai_maxTokens', e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <Label info={<>Minimum score a lead must have to be imported. Scored 0–10 based on:<br /><br />• Industry match (30%)<br />• Seniority level (25%)<br />• Company size (20%)<br />• Geography (15%)<br />• Tech stack bonus (10%)<br /><br /><strong>0</strong> — disabled (let every Apify-filtered lead through)<br /><strong>4–5</strong> — permissive<br /><strong>6</strong> — default (balanced)<br /><strong>7–8</strong> — strict, high quality only<br /><br />💡 If your Apify filter is already strict (job titles, location, size), set this to <strong>0</strong> to avoid double-filtering.</>}>Lead Score Threshold</Label>
              <input type="number" min={0} max={10} value={form.qualification_threshold} onChange={e => set('qualification_threshold', e.target.value)} style={inputStyle} />
              {parseInt(form.qualification_threshold) === 0 && (
                <small style={{ fontSize: '11px', color: '#888', marginTop: '4px', display: 'block' }}>
                  ⚠️ Qualifier disabled — every Apify-filtered lead will be imported.
                </small>
              )}
            </div>
          </div>
        </div>

        {/* Send Settings */}
        <div style={sectionStyle}>
          <div style={sectionHead}>📤 Send Settings</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div style={fieldStyle}>
              <Label info={<>Maximum emails sent per day across ALL SMTP accounts combined.<br /><br />This is a hard cap. Even if SMTP accounts have higher individual limits, this global limit applies.<br /><br />Recommended: start at <strong>20–30</strong> for new domains, scale up after 2–3 weeks of warmup.</>}>Daily Send Limit</Label>
              <input type="number" min={1} max={500} value={form.campaign_dailyLimit} onChange={e => set('campaign_dailyLimit', e.target.value)} style={inputStyle} />
              <small style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', display: 'block' }}>Across all SMTP accounts combined</small>
            </div>
            <div style={fieldStyle}>
              <Label info={<>Minimum wait time between sending each email (in seconds).<br /><br />Random delay between Min and Max is applied after each send to simulate human behavior and avoid rate limiting by SMTP providers.<br /><br />Recommended minimum: <strong>8–10 seconds</strong></>}>Delay Min (sec)</Label>
              <input type="number" min={1} value={form.campaign_delayMinSec} onChange={e => set('campaign_delayMinSec', e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <Label info={<>Maximum wait time between each email send (in seconds).<br /><br />The system picks a random number between Min and Max for each send. Higher max = more human-like pattern.<br /><br />Recommended: <strong>20–40 seconds</strong></>}>Delay Max (sec)</Label>
              <input type="number" min={1} value={form.campaign_delayMaxSec} onChange={e => set('campaign_delayMaxSec', e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ ...fieldStyle, marginTop: '16px' }}>
            <Label info={<>Optional Calendly URL the AI will include as the call-to-action.<br /><br />Leave blank to send emails without a calendar link (uses a reply-based ask instead).<br /><br />Example: <code>https://calendly.com/your-name/intro-call</code><br /><br /><strong>Important:</strong> if your system prompt explicitly forbids Calendly links (e.g. "Never paste the Calendly URL"), remove that rule from the prompt — otherwise the AI will ignore this field.</>}>Calendly URL (optional)</Label>
            <input
              type="url"
              placeholder="https://calendly.com/your-handle/intro-call"
              value={form.campaign_calendlyUrl}
              onChange={e => set('campaign_calendlyUrl', e.target.value)}
              style={inputStyle}
            />
            <small style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', display: 'block' }}>
              When set, AI inserts this link as the CTA. Only calendly.com URLs are allowed through the URL stripper.
            </small>
          </div>

          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f0f0f0' }}>
            <Toggle
              checked={form.campaign_followUpsEnabled}
              onChange={() => set('campaign_followUpsEnabled', !form.campaign_followUpsEnabled)}
              label="Send follow-up emails"
              hint="Master switch — turn off to disable all follow-ups (cron, manual button, and per-contact send) for this brand"
              info={<>When OFF, all follow-up sending is blocked for this brand:<br />• The scheduled <strong>Send Follow-ups</strong> cron is skipped<br />• The manual <strong>Send Follow-ups</strong> button on Pipeline does nothing<br />• The <strong>per-contact follow-up</strong> button is rejected<br /><br />Initial sends and bounce checks still run normally.</>}
            />
          </div>

          <div style={{ ...fieldStyle, marginTop: '16px', opacity: form.campaign_followUpsEnabled ? 1 : 0.5, pointerEvents: form.campaign_followUpsEnabled ? 'auto' : 'none' }}>
            <Label info={<>How many days after the initial email to send the single follow-up. Default 6 days.<br /><br />The follow-up is sent only if the contact has <strong>not replied</strong> and the email did <strong>not bounce</strong>.</>}>Follow-Up Day</Label>
            <input
              type="number"
              min="1"
              max="30"
              value={form.campaign_followUpDay}
              onChange={e => set('campaign_followUpDay', e.target.value)}
              style={inputStyle}
            />
            <small style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', display: 'block' }}>
              Days after initial send. Skipped if recipient replied or bounced.
            </small>
          </div>

          <div style={{ ...fieldStyle, marginTop: '16px' }}>
            <Label info={<>Custom instructions for the AI when writing the follow-up email. Keep it soft, polite, generic.<br /><br />Leave blank to use the system default (gentle nudge referencing the original email).</>}>Follow-Up Email Prompt (optional)</Label>
            <textarea
              rows="6"
              placeholder={`Write a brief, friendly follow-up to my previous email.\n\n- Tone: warm, respectful, no pressure\n- Acknowledge they may have missed the first email\n- Briefly restate the value in one sentence\n- End with a soft yes/no question\n- Under 60 words\n- Do not be salesy or pushy`}
              value={form.campaign_followUpPrompt}
              onChange={e => set('campaign_followUpPrompt', e.target.value)}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}
            />
            <small style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', display: 'block' }}>
              Customize how follow-ups are written. Leave blank for system default.
            </small>
          </div>

          <Toggle
            checked={form.campaign_timezoneFilter}
            onChange={() => set('campaign_timezoneFilter', !form.campaign_timezoneFilter)}
            label="Timezone Filter"
            hint="Only send when it's 9 AM–5 PM in the recipient's country"
            info={<>When enabled, the system checks the contact's country and only sends if it is currently <strong>9 AM – 5 PM</strong> in their local time.<br /><br />Contacts outside business hours are <strong>skipped and retried</strong> on the next pipeline run. This significantly improves open rates.<br /><br />Disable only if you're testing or don't care about delivery timing.</>}
          />
          <Toggle
            checked={form.campaign_spamFilter}
            onChange={() => set('campaign_spamFilter', !form.campaign_spamFilter)}
            label="Spam Word Filter"
            hint="Block emails containing spam trigger words before they're sent"
            info={
              <div>
                Scans email subject + body before sending. If any trigger is found, the contact is marked <strong>SpamBlocked</strong> instead of being sent.<br /><br />
                <strong>Detected phrases include:</strong>
                <div style={{ marginTop: '6px', maxHeight: '140px', overflowY: 'auto', fontSize: '11px', lineHeight: '1.8', color: '#ccc' }}>
                  {SPAM_WORDS.slice(0, 20).map(w => <div key={w}>• {w}</div>)}
                  <div style={{ color: '#888', marginTop: '4px' }}>+{SPAM_WORDS.length - 20} more phrases</div>
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#aaa' }}>
                  Also detects: {SPAM_PATTERNS.join(' · ')}
                </div>
              </div>
            }
          />
        </div>

        {/* Upload Batches — pause/resume sending per file */}
        <div style={sectionStyle}>
          <div style={sectionHead}>📁 Upload Batches</div>
          <UploadBatchesSection brandId={brandId} />
        </div>

        {/* Scheduled Automation */}
        <div style={sectionStyle}>
          <div style={sectionHead}>⏰ Scheduled Automation</div>
          <Toggle
            checked={form.cron_enabled}
            onChange={() => set('cron_enabled', !form.cron_enabled)}
            label="Enable automatic scheduling"
            hint="Run generate, send, and bounce check on a fixed schedule without manual triggering"
            info={<>When enabled, three separate cron jobs run automatically:<br /><br /><strong>Generate</strong> — AI writes emails for pending contacts<br /><strong>Send</strong> — Sends all generated emails<br /><strong>Check Bounces</strong> — Scans IMAP for replies and bounces<br /><br />Recommended: keep disabled until you've tested manually and are happy with email quality.</>}
          />
          {form.cron_enabled && (
            <>
              <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#7a5500' }}>
                ⚠️ Set times in your <strong>recipients' timezone</strong> (select below). Best sending window: <strong>9 AM – 2 PM</strong> recipient local time.
              </div>

              {/* Timezone */}
              <div style={fieldStyle}>
                <Label info="All schedule times below are in this timezone. Use your recipients' timezone, not yours.">Recipients' Timezone</Label>
                <select value={form.cron_timezone} onChange={e => set('cron_timezone', e.target.value)} style={{ ...inputStyle, maxWidth: '320px' }}>
                  <option value="America/New_York">🇺🇸 US East Coast (New York)</option>
                  <option value="America/Chicago">🇺🇸 US Central (Chicago)</option>
                  <option value="America/Los_Angeles">🇺🇸 US West Coast (Los Angeles)</option>
                  <option value="Europe/London">🇬🇧 UK (London)</option>
                  <option value="Europe/Berlin">🇪🇺 Europe (Berlin / Paris)</option>
                  <option value="Asia/Dubai">🇦🇪 UAE (Dubai)</option>
                  <option value="Asia/Karachi">🇵🇰 Pakistan (Karachi)</option>
                  <option value="Australia/Sydney">🇦🇺 Australia (Sydney)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>

              {/* Generate Emails */}
              <div style={{ background: '#f8f9ff', border: '1px solid #e8ecff', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#3a3a6e', marginBottom: '10px' }}>✍️ Generate Emails — AI writes emails for pending contacts</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>Run at</span>
                  <select value={form.cron_generate_hour} onChange={e => set('cron_generate_hour', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                    {SCHEDULE_HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                  <span style={{ fontSize: '13px', color: '#555' }}>on</span>
                  <select value={form.cron_generate_days} onChange={e => set('cron_generate_days', e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                    {DAYS_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                  💡 Run this the evening before sending so you can review emails first.
                </div>
              </div>

              {/* Send Emails */}
              <div style={{ background: '#f8f9ff', border: '1px solid #e8ecff', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#3a3a6e', marginBottom: '10px' }}>📤 Send Emails — Sends all generated emails</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>Run at</span>
                  <select value={form.cron_send_hour} onChange={e => set('cron_send_hour', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                    {SCHEDULE_HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                  <span style={{ fontSize: '13px', color: '#555' }}>on</span>
                  <select value={form.cron_send_days} onChange={e => set('cron_send_days', e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                    {DAYS_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                  💡 Best times: 9 AM or 1 PM in recipient's local time.
                </div>
              </div>

              {/* Send Follow-ups */}
              <div style={{ background: '#f8f9ff', border: '1px solid #e8ecff', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#3a3a6e', marginBottom: '10px' }}>🔁 Send Follow-ups — One follow-up per contact (no reply, no bounce)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>Run at</span>
                  <select value={form.cron_followup_hour} onChange={e => set('cron_followup_hour', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                    {SCHEDULE_HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                  <span style={{ fontSize: '13px', color: '#555' }}>on</span>
                  <select value={form.cron_followup_days} onChange={e => set('cron_followup_days', e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                    {DAYS_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                  💡 Sent N days after the initial email (configurable in Send Settings · Follow-Up Day).
                </div>
              </div>

              {/* Apify Auto-Scrape */}
              <div style={{ background: '#f0fff7', border: '1px solid #b8e6c9', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#1f7a47', marginBottom: '10px' }}>🎯 Apify Auto-Scrape — Pulls fresh leads (uses operator timezone, NOT recipient)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>Fetch</span>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={form.apify_fetch_count}
                    onChange={e => set('apify_fetch_count', e.target.value)}
                    style={{ ...inputStyle, width: '90px' }}
                  />
                  <span style={{ fontSize: '13px', color: '#555' }}>leads,</span>
                  <select value={form.cron_scrape_freq} onChange={e => set('cron_scrape_freq', e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                    {SCRAPE_FREQS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    <option value="one_shot">One-shot — pick exact date/time below</option>
                  </select>
                </div>

                {form.cron_scrape_freq !== 'disabled' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {form.cron_scrape_freq === 'one_shot' && (
                      <>
                        <span style={{ fontSize: '13px', color: '#555' }}>on</span>
                        <select value={form.cron_scrape_month} onChange={e => set('cron_scrape_month', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]}</option>)}
                        </select>
                        <select value={form.cron_scrape_day} onChange={e => set('cron_scrape_day', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </>
                    )}
                    <span style={{ fontSize: '13px', color: '#555' }}>at</span>
                    <select value={form.cron_scrape_hour} onChange={e => set('cron_scrape_hour', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                      {SCHEDULE_HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                    <span style={{ fontSize: '13px', color: '#555' }}>:</span>
                    <select value={form.cron_scrape_minute} onChange={e => set('cron_scrape_minute', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                      {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                    </select>
                    <span style={{ fontSize: '13px', color: '#555' }}>in</span>
                    <select value={form.cron_scrape_timezone} onChange={e => set('cron_scrape_timezone', e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                      {COMMON_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ fontSize: '11px', color: '#888' }}>
                  💡 Lead scraping runs in <strong>your</strong> timezone (the operator), not the recipients'. Auto-imports new contacts (skips duplicates). Max 1,000 per run.
                </div>
              </div>

              {/* Check Bounces / Replies */}
              <div style={{ background: '#f8f9ff', border: '1px solid #e8ecff', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#3a3a6e', marginBottom: '10px' }}>📬 Check for Replies & Bounces — Scans inbox automatically</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>Check</span>
                  <select value={form.cron_bounces_freq} onChange={e => set('cron_bounces_freq', e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                    {BOUNCE_FREQS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  {form.cron_bounces_freq === 'daily' && (
                    <>
                      <span style={{ fontSize: '13px', color: '#555' }}>at</span>
                      <select value={form.cron_bounces_hour} onChange={e => set('cron_bounces_hour', parseInt(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                        {SCHEDULE_HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                      </select>
                    </>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                  💡 Every 30 minutes or every hour is recommended so replies show up quickly.
                </div>
              </div>
            </>
          )}
        </div>

        {/* Notifications */}
        <div style={sectionStyle}>
          <div style={sectionHead}>🔔 Notifications</div>
          <Toggle
            checked={form.slack_enabled}
            onChange={() => set('slack_enabled', !form.slack_enabled)}
            label="Slack notifications"
            hint="Get notified in Slack when a prospect replies or bounces"
            info={<>Sends a message to your Slack channel via webhook when:<br />• A prospect replies to your email<br />• An email bounces (hard bounce detected)<br /><br />Get a webhook URL from: Slack → Apps → Incoming Webhooks</>}
          />
          {form.slack_enabled && (
            <>
              <div style={fieldStyle}>
                <Label info="Slack incoming webhook URL. Found in your Slack workspace under Apps → Incoming Webhooks.">Slack Webhook URL</Label>
                <input type="url" value={form.slack_webhookUrl} onChange={e => set('slack_webhookUrl', e.target.value)} style={inputStyle} placeholder="https://hooks.slack.com/services/..." />
              </div>
              <div style={{ display: 'flex', gap: '24px' }}>
                <Toggle checked={form.slack_notifyOnReply} onChange={() => set('slack_notifyOnReply', !form.slack_notifyOnReply)} label="On reply" />
                <Toggle checked={form.slack_notifyOnBounce} onChange={() => set('slack_notifyOnBounce', !form.slack_notifyOnBounce)} label="On bounce" />
              </div>
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '4px' }}>
            <div style={fieldStyle}>
              <Label info="When a prospect replies to your cold email, the full reply text is forwarded to this address.">Email on Reply</Label>
              <input type="email" value={form.notify_replyEmail} onChange={e => set('notify_replyEmail', e.target.value)} style={inputStyle} placeholder="you@example.com" />
            </div>
            <div style={fieldStyle}>
              <Label info="When an email hard-bounces (address doesn't exist), a notification is sent here.">Email on Bounce</Label>
              <input type="email" value={form.notify_bounceEmail} onChange={e => set('notify_bounceEmail', e.target.value)} style={inputStyle} placeholder="you@example.com" />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: '40px' }}>
          <button type="submit" disabled={saving} style={{ padding: '11px 32px', borderRadius: '8px', border: 'none', background: saved ? '#198754' : '#0f3460', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '600', transition: 'background 0.2s' }}>
            {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Settings'}
          </button>
        </div>

      </form>
    </div>
  )
}
