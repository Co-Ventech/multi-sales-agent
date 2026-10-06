import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import apiClient from '../../api/client'
import SmtpCard from '../../components/SmtpCard'

const EMPTY_FORM = {
  host: '', port: 587, username: '', password: '',
  fromEmail: '', fromName: '', replyTo: '',
  senderName: '', senderPosition: 'Business Development',
  senderWebsite: '', senderPhone: '',
  dailyLimit: 10, warmupStartDate: '', useTLS: true, useSSL: false, isActive: true
}

export default function SmtpAccounts() {
  const { brandId } = useParams()
  const [accounts, setAccounts] = useState([])
  const [rotation, setRotation] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [testResults, setTestResults] = useState({})

  const fetchData = async () => {
    try {
      const [acctRes, rotRes] = await Promise.allSettled([
        apiClient.get(`/brands/${brandId}/smtp`),
        apiClient.get(`/brands/${brandId}/stats/rotation`)
      ])
      if (acctRes.status === 'fulfilled') setAccounts(acctRes.value.data)
      if (rotRes.status === 'fulfilled') {
        const rotMap = {}
        rotRes.value.data.forEach(r => { rotMap[r.accountId] = r.todayCount })
        setRotation(rotMap)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [brandId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const openAdd = () => { setForm(EMPTY_FORM); setEditingAccount(null); setShowModal(true) }
  const openEdit = (acct) => {
    setForm({
      host: acct.host || '',
      port: acct.port || 587,
      username: acct.username || '',
      password: '',
      fromEmail: acct.fromEmail || '',
      fromName: acct.fromName || '',
      replyTo: acct.replyTo || '',
      senderName: acct.senderName || '',
      senderPosition: acct.senderPosition || 'Business Development',
      senderWebsite: acct.senderWebsite || '',
      senderPhone: acct.senderPhone || '',
      dailyLimit: acct.dailyLimit || 10,
      warmupStartDate: acct.warmupStartDate ? acct.warmupStartDate.slice(0, 10) : '',
      useTLS: acct.useTLS ?? true,
      useSSL: acct.useSSL ?? false,
      isActive: acct.isActive ?? true
    })
    setEditingAccount(acct)
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form, port: parseInt(form.port), dailyLimit: parseInt(form.dailyLimit) }
      if (!payload.warmupStartDate) delete payload.warmupStartDate
      if (editingAccount) {
        if (!payload.password) delete payload.password
        await apiClient.put(`/brands/${brandId}/smtp/${editingAccount._id}`, payload)
      } else {
        await apiClient.post(`/brands/${brandId}/smtp`, payload)
      }
      setShowModal(false)
      fetchData()
    } catch (err) {
      alert(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (acct) => {
    if (!window.confirm(`Delete SMTP account ${acct.fromEmail}?`)) return
    try {
      await apiClient.delete(`/brands/${brandId}/smtp/${acct._id}`)
      fetchData()
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed')
    }
  }

  const handleTest = async (acct) => {
    setTestResults(prev => ({ ...prev, [acct._id]: 'testing' }))
    try {
      const res = await apiClient.post(`/brands/${brandId}/smtp/${acct._id}/test`)
      setTestResults(prev => ({ ...prev, [acct._id]: res.data }))
    } catch {
      setTestResults(prev => ({ ...prev, [acct._id]: { ok: false, message: 'Request failed' } }))
    }
  }

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px' }
  const labelStyle = { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '4px', textTransform: 'uppercase' }

  if (loading) return <div style={{ padding: '32px', color: '#888' }}>Loading...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e' }}>SMTP Accounts</h1>
        <button onClick={openAdd} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#0f3460', color: '#fff', cursor: 'pointer', fontSize: '14px' }}>
          + Add Account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', background: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <p style={{ color: '#888', marginBottom: '16px' }}>No SMTP accounts configured yet</p>
          <button onClick={openAdd} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#0f3460', color: '#fff', cursor: 'pointer' }}>
            Add First Account
          </button>
        </div>
      ) : (
        <div>
          {accounts.map(acct => {
            const testResult = testResults[acct._id]
            return (
              <div key={acct._id} style={{ marginBottom: '16px' }}>
                <SmtpCard
                  account={{ ...acct, todayCount: rotation[acct._id] || 0 }}
                  onTest={handleTest}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
                {testResult && testResult !== 'testing' && (
                  <div style={{
                    marginTop: '6px', padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
                    background: testResult.ok ? '#d1e7dd' : '#f8d7da',
                    color: testResult.ok ? '#0a3622' : '#721c24'
                  }}>
                    {testResult.ok ? '✓' : '✗'} {testResult.message}
                  </div>
                )}
                {testResult === 'testing' && (
                  <div style={{ marginTop: '6px', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: '#fff3cd', color: '#856404' }}>
                    Testing connection...
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '28px', width: '100%', maxWidth: '560px', maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '20px' }}>
              {editingAccount ? 'Edit SMTP Account' : 'Add SMTP Account'}
            </h3>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div><label style={labelStyle}>SMTP Host *</label><input required value={form.host} onChange={e => set('host', e.target.value)} placeholder="smtp.gmail.com" style={inputStyle} /></div>
                <div><label style={labelStyle}>Port</label><input type="number" value={form.port} onChange={e => set('port', e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div><label style={labelStyle}>Username *</label><input required value={form.username} onChange={e => set('username', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Password {editingAccount ? '(leave blank to keep)' : '*'}</label><input type="password" required={!editingAccount} value={form.password} onChange={e => set('password', e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div><label style={labelStyle}>From Email *</label><input required type="email" value={form.fromEmail} onChange={e => set('fromEmail', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>From Name</label><input value={form.fromName} onChange={e => set('fromName', e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div><label style={labelStyle}>Reply-To</label><input type="email" value={form.replyTo} onChange={e => set('replyTo', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Sender Name</label><input value={form.senderName} onChange={e => set('senderName', e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div><label style={labelStyle}>Position/Title</label><input value={form.senderPosition} onChange={e => set('senderPosition', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Sender Website</label><input value={form.senderWebsite} onChange={e => set('senderWebsite', e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div><label style={labelStyle}>Phone</label><input value={form.senderPhone} onChange={e => set('senderPhone', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Daily Limit</label><input type="number" min={1} value={form.dailyLimit} onChange={e => set('dailyLimit', e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>Warmup Start Date (optional)</label>
                <input type="date" value={form.warmupStartDate} onChange={e => set('warmupStartDate', e.target.value)} style={inputStyle} />
                <p style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>If set, daily limit will ramp up from 5→10→15→full over 3 weeks</p>
              </div>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                {[['useTLS', 'Use TLS'], ['useSSL', 'Use SSL'], ['isActive', 'Active']].map(([k, l]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)} />
                    {l}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: '#0f3460', color: '#fff', cursor: 'pointer' }}>
                  {saving ? 'Saving...' : 'Save Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
