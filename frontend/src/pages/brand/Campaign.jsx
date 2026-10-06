import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import apiClient from '../../api/client'

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: '8px',
  border: '1px solid #ddd', fontSize: '13px', outline: 'none'
}
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: '600', color: '#555', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.3px' }
const fieldStyle = { marginBottom: '18px' }
const sectionStyle = { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '20px' }

const Toggle = ({ checked, onChange, label, hint }) => (
  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '12px' }}>
    <div
      style={{ width: '40px', height: '22px', borderRadius: '11px', background: checked ? '#0f3460' : '#ccc', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0, marginTop: '1px' }}
      onClick={onChange}
    >
      <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px', left: checked ? '20px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </div>
    <div>
      <div style={{ fontSize: '13px', fontWeight: '500' }}>{label}</div>
      {hint && <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{hint}</div>}
    </div>
  </label>
)

export default function Campaign() {
  const { brandId } = useParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    openai_systemPrompt: '',
    campaign_dailyLimit: 20,
    campaign_delayMinSec: 8,
    campaign_delayMaxSec: 20,
    campaign_timezoneFilter: true,
    campaign_spamFilter: true
  })

  useEffect(() => {
    apiClient.get(`/brands/${brandId}`)
      .then(res => {
        const b = res.data
        setForm({
          openai_systemPrompt: b.openai?.systemPrompt || '',
          campaign_dailyLimit: b.campaign?.dailyLimit ?? 20,
          campaign_delayMinSec: b.campaign?.delayMinSec ?? 8,
          campaign_delayMaxSec: b.campaign?.delayMaxSec ?? 20,
          campaign_timezoneFilter: b.campaign?.timezoneFilter ?? true,
          campaign_spamFilter: b.campaign?.spamFilter ?? true
        })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [brandId])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await apiClient.put(`/brands/${brandId}`, {
        openai: { systemPrompt: form.openai_systemPrompt },
        campaign: {
          dailyLimit: parseInt(form.campaign_dailyLimit),
          delayMinSec: parseInt(form.campaign_delayMinSec),
          delayMaxSec: parseInt(form.campaign_delayMaxSec),
          timezoneFilter: form.campaign_timezoneFilter,
          spamFilter: form.campaign_spamFilter
        }
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  if (loading) return <div style={{ padding: '32px', color: '#888' }}>Loading...</div>

  return (
    <div style={{ maxWidth: '720px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e', marginBottom: '24px' }}>Campaign</h1>

      <form onSubmit={handleSave}>
        {/* System Prompt */}
        <div style={sectionStyle}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#333', marginBottom: '8px' }}>AI System Prompt</h3>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '14px', lineHeight: '1.6' }}>
            This is the full instruction given to the AI for writing each email. Include your tone, CTA, value proposition,
            Calendly link, case studies, and any rules. The AI will fill in contact-specific details automatically.
          </p>
          <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px', fontSize: '12px', color: '#555', lineHeight: '1.7' }}>
            <strong>Include in your prompt:</strong><br />
            • Your <strong>tone</strong> — e.g. "Write in a direct, conversational tone. No corporate language."<br />
            • Your <strong>CTA</strong> — e.g. "End with: Worth a 15-minute call this week?"<br />
            • Your <strong>value prop</strong> — e.g. "We help SaaS companies reduce QA time by 60%."<br />
            • <strong>Calendly link</strong> — e.g. "Our booking link: https://calendly.com/yourname"<br />
            • <strong>Case studies</strong> — 2–3 examples with metrics the AI can reference
          </div>
          <div style={fieldStyle}>
            <textarea
              value={form.openai_systemPrompt}
              onChange={e => set('openai_systemPrompt', e.target.value)}
              rows={14}
              placeholder={`You are a cold email copywriter for [Company Name].\n\nValue proposition: We help SaaS companies reduce QA costs by 60% using AI-powered test automation.\n\nTone: Direct, conversational, no corporate buzzwords.\n\nCTA: End every email with: "Worth a quick call?"\n\nRules:\n- Under 75 words\n- Open with a specific observation about their company\n- Reference one relevant case study\n- No links, no tracking pixels`}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6' }}
            />
          </div>
        </div>

        {/* Send Settings */}
        <div style={sectionStyle}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#333', marginBottom: '16px' }}>Send Settings</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Daily Send Limit</label>
              <input type="number" min={1} max={500} value={form.campaign_dailyLimit} onChange={e => set('campaign_dailyLimit', e.target.value)} style={inputStyle} />
              <small style={{ fontSize: '11px', color: '#888' }}>Max emails per day across all SMTP accounts</small>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Delay Min (sec)</label>
              <input type="number" min={1} value={form.campaign_delayMinSec} onChange={e => set('campaign_delayMinSec', e.target.value)} style={inputStyle} />
              <small style={{ fontSize: '11px', color: '#888' }}>Wait at least this long between sends</small>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Delay Max (sec)</label>
              <input type="number" min={1} value={form.campaign_delayMaxSec} onChange={e => set('campaign_delayMaxSec', e.target.value)} style={inputStyle} />
              <small style={{ fontSize: '11px', color: '#888' }}>Random delay up to this value</small>
            </div>
          </div>

          <div style={{ marginTop: '4px' }}>
            <Toggle
              checked={form.campaign_timezoneFilter}
              onChange={() => set('campaign_timezoneFilter', !form.campaign_timezoneFilter)}
              label="Timezone Filter"
              hint="Only send to contacts when it is 9 AM–5 PM in their country. Skips contacts outside business hours and retries them next run."
            />
            <Toggle
              checked={form.campaign_spamFilter}
              onChange={() => set('campaign_spamFilter', !form.campaign_spamFilter)}
              label="Spam Word Filter"
              hint="Before sending, scan the AI-generated email for spam trigger words (free, urgent, guaranteed, etc.). If found, mark contact as SpamBlocked instead of sending."
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '10px 24px', borderRadius: '8px', border: 'none',
            background: saved ? '#198754' : '#0f3460', color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500'
          }}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </form>
    </div>
  )
}
