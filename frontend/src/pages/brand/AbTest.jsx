import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import apiClient from '../../api/client'

export default function AbTest() {
  const { brandId } = useParams()
  const [brand, setBrand] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState(null)
  const [stats, setStats] = useState({ byStatus: {} })
  const [abStats, setAbStats] = useState(null)

  const [form, setForm] = useState({
    enabled: false,
    promptA: '',
    promptB: ''
  })

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [brandRes, statsRes, abStatsRes] = await Promise.allSettled([
          apiClient.get(`/brands/${brandId}`),
          apiClient.get(`/brands/${brandId}/stats`),
          apiClient.get(`/brands/${brandId}/stats/ab`)
        ])
        if (brandRes.status === 'fulfilled') {
          const b = brandRes.value.data
          setBrand(b)
          setForm({
            enabled: b.abTest?.enabled || false,
            promptA: b.abTest?.promptA || '',
            promptB: b.abTest?.promptB || ''
          })
        }
        if (statsRes.status === 'fulfilled') setStats(statsRes.value.data)
        if (abStatsRes.status === 'fulfilled') setAbStats(abStatsRes.value.data)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [brandId])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await apiClient.put(`/brands/${brandId}`, {
        abTest: { enabled: form.enabled, promptA: form.promptA, promptB: form.promptB }
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handlePreview = async () => {
    if (!form.enabled || !form.promptA || !form.promptB) {
      alert('Enable A/B testing and fill in both prompts first')
      return
    }
    setPreviewing(true)
    setPreviewResult(null)
    try {
      // Save first, then preview
      await apiClient.put(`/brands/${brandId}`, {
        abTest: { enabled: form.enabled, promptA: form.promptA, promptB: form.promptB }
      })
      const res = await apiClient.post(`/brands/${brandId}/preview/ab`, {})
      setPreviewResult(res.data)
    } catch (err) {
      alert(err.response?.data?.error || 'Preview failed. Make sure OpenAI is configured.')
    } finally {
      setPreviewing(false)
    }
  }

  // Compute A/B stats from contacts
  if (loading) return <div style={{ padding: '32px', color: '#888' }}>Loading...</div>

  return (
    <div style={{ maxWidth: '900px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e', marginBottom: '24px' }}>A/B Testing</h1>

      <form onSubmit={handleSave}>
        {/* Enable toggle */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <div style={{
              width: '44px', height: '24px', borderRadius: '12px',
              background: form.enabled ? '#0f3460' : '#ccc',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s'
            }} onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}>
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', background: '#fff',
                position: 'absolute', top: '2px',
                left: form.enabled ? '22px' : '2px',
                transition: 'left 0.2s',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
              }} />
            </div>
            <div>
              <span style={{ fontWeight: '600', fontSize: '14px' }}>Enable A/B Testing</span>
              <p style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                Alternate between two prompts for each contact. Track reply rates per variant.
              </p>
            </div>
          </label>
        </div>

        {/* Prompt editors */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          {['A', 'B'].map(v => (
            <div key={v} style={{
              background: '#fff', borderRadius: '12px', padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              borderTop: `3px solid ${v === 'A' ? '#0d6efd' : '#198754'}`
            }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px', color: v === 'A' ? '#0d6efd' : '#198754' }}>
                Variant {v}
              </h3>
              <textarea
                value={form[`prompt${v}`]}
                onChange={e => setForm(f => ({ ...f, [`prompt${v}`]: e.target.value }))}
                rows={12}
                placeholder={`System prompt for variant ${v}...`}
                disabled={!form.enabled}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px',
                  border: '1px solid #ddd', fontSize: '12px', fontFamily: 'monospace',
                  resize: 'vertical', opacity: form.enabled ? 1 : 0.5
                }}
              />
            </div>
          ))}
        </div>

        {/* Stats */}
        {brand?.abTest?.enabled && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>A/B Performance Stats</h3>
            {abStats && (abStats.A.total > 0 || abStats.B.total > 0) ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {['A', 'B'].map(v => {
                  const s = abStats[v]
                  const color = v === 'A' ? '#0d6efd' : '#198754'
                  return (
                    <div key={v} style={{ border: `2px solid ${color}`, borderRadius: '10px', padding: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: '700', color, marginBottom: '12px' }}>
                        Variant {v} — {s.total} contacts
                      </div>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <Stat label="Sent"     value={s.sent}    />
                        <Stat label="Replied"  value={s.replied} color="#198754" />
                        <Stat label="Bounced"  value={s.bounced} color="#dc3545" />
                        <Stat label="Reply Rate" value={`${s.replyRate}%`} color={s.replyRate > 0 ? '#198754' : '#888'} bold />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p style={{ color: '#888', fontSize: '13px' }}>
                No A/B data yet. Stats will appear here after the pipeline runs and emails are sent.
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '10px 24px', borderRadius: '8px', border: 'none',
              background: saved ? '#198754' : '#0f3460', color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500'
            }}
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </button>
          <button
            type="button"
            onClick={handlePreview}
            disabled={previewing || !form.enabled}
            style={{
              padding: '10px 24px', borderRadius: '8px', border: '1px solid #0d6efd',
              background: '#fff', color: '#0d6efd',
              cursor: previewing || !form.enabled ? 'not-allowed' : 'pointer',
              fontSize: '14px', fontWeight: '500', opacity: !form.enabled ? 0.5 : 1
            }}
          >
            {previewing ? 'Generating...' : 'Preview Both'}
          </button>
        </div>
      </form>

      {/* Preview results */}
      {previewResult && (
        <div style={{ marginTop: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Preview Results</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {[
              { label: 'Variant A', data: previewResult.variantA, color: '#0d6efd' },
              { label: 'Variant B', data: previewResult.variantB, color: '#198754' }
            ].map(({ label, data, color }) => (
              <div key={label} style={{
                background: '#fff', borderRadius: '12px', padding: '20px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                borderTop: `3px solid ${color}`
              }}>
                <h4 style={{ color, marginBottom: '12px', fontSize: '13px', fontWeight: '700' }}>{label}</h4>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: '600' }}>Subject</span>
                  <div style={{ fontWeight: '600', marginTop: '2px', fontSize: '13px' }}>{data.subject}</div>
                </div>
                <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', fontWeight: '600', marginBottom: '4px' }}>Body</div>
                <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '12px', fontSize: '12px', whiteSpace: 'pre-wrap', lineHeight: '1.7' }}>
                  {data.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, bold }) {
  return (
    <div style={{ textAlign: 'center', minWidth: '64px' }}>
      <div style={{ fontSize: '22px', fontWeight: bold ? 700 : 600, color: color || '#2d3748' }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#718096', marginTop: '2px' }}>{label}</div>
    </div>
  )
}
