import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import apiClient from '../../api/client'

const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px' }
const labelStyle = { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '4px', textTransform: 'uppercase' }

export default function Preview() {
  const { brandId } = useParams()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const [contacts, setContacts] = useState([])
  const [contactSearch, setContactSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const [contact, setContact] = useState({
    firstName: '', lastName: '', jobTitle: '', companyName: '',
    industry: '', technologyStack: '', country: 'United States',
    companyDescription: '', companySize: '', headline: '', seniorityLevel: ''
  })

  useEffect(() => {
    apiClient.get(`/brands/${brandId}/contacts`, { params: { limit: 200 } })
      .then(res => setContacts(res.data.contacts || []))
      .catch(() => {})
  }, [brandId])

  const filtered = contacts.filter(c => {
    if (!contactSearch) return true
    const q = contactSearch.toLowerCase()
    return (
      (c.firstName + ' ' + c.lastName).toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.companyName || '').toLowerCase().includes(q)
    )
  }).slice(0, 12)

  const selectContact = (c) => {
    setContact({
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      jobTitle: c.jobTitle || '',
      companyName: c.companyName || '',
      industry: c.industry || '',
      technologyStack: (c.technologyStack || []).join(', '),
      country: c.country || 'United States',
      companyDescription: c.companyDescription || '',
      companySize: c.companySize || '',
      headline: c.headline || '',
      seniorityLevel: c.seniorityLevel || ''
    })
    setContactSearch(`${c.firstName || ''} ${c.lastName || ''} — ${c.companyName || ''}`.trim())
    setShowDropdown(false)
    setResult(null)
  }

  const setField = (k, v) => setContact(c => ({ ...c, [k]: v }))

  const handleGenerate = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await apiClient.post(`/brands/${brandId}/preview`, {
        contact: {
          ...contact,
          technologyStack: contact.technologyStack.split(',').map(s => s.trim()).filter(Boolean)
        }
      })
      setResult(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Preview generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e', marginBottom: '24px' }}>Email Preview</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Contact form */}
        <div>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>

            {/* Contact picker */}
            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #f0f0f0' }}>
              <label style={labelStyle}>Select from existing contacts</label>
              <div style={{ position: 'relative' }}>
                <input
                  value={contactSearch}
                  onChange={e => { setContactSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search by name, email, or company..."
                  style={{ ...inputStyle, paddingRight: '32px' }}
                />
                {contactSearch && (
                  <button
                    type="button"
                    onClick={() => { setContactSearch(''); setShowDropdown(false) }}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '16px', lineHeight: 1 }}
                  >×</button>
                )}
                {showDropdown && filtered.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: '260px', overflowY: 'auto', marginTop: '4px' }}>
                    {filtered.map(c => (
                      <div
                        key={c._id}
                        onClick={() => selectContact(c)}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f5f5f5', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8f9fa'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a2e' }}>
                          {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>
                          {c.jobTitle && `${c.jobTitle} · `}{c.companyName || ''}{c.country ? ` · ${c.country}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <small style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', display: 'block' }}>
                Or fill in the fields below manually
              </small>
            </div>

            <form onSubmit={handleGenerate}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div><label style={labelStyle}>First Name</label><input value={contact.firstName} onChange={e => setField('firstName', e.target.value)} style={inputStyle} placeholder="Alex" /></div>
                <div><label style={labelStyle}>Last Name</label><input value={contact.lastName} onChange={e => setField('lastName', e.target.value)} style={inputStyle} placeholder="Johnson" /></div>
              </div>
              <div style={{ marginBottom: '10px' }}><label style={labelStyle}>Job Title</label><input value={contact.jobTitle} onChange={e => setField('jobTitle', e.target.value)} style={inputStyle} placeholder="CTO" /></div>
              <div style={{ marginBottom: '10px' }}><label style={labelStyle}>Company</label><input value={contact.companyName} onChange={e => setField('companyName', e.target.value)} style={inputStyle} placeholder="Acme Corp" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div><label style={labelStyle}>Industry</label><input value={contact.industry} onChange={e => setField('industry', e.target.value)} style={inputStyle} placeholder="SaaS" /></div>
                <div><label style={labelStyle}>Country</label><input value={contact.country} onChange={e => setField('country', e.target.value)} style={inputStyle} /></div>
              </div>
              <div style={{ marginBottom: '10px' }}><label style={labelStyle}>Tech Stack (comma-separated)</label><input value={contact.technologyStack} onChange={e => setField('technologyStack', e.target.value)} style={inputStyle} placeholder="React, Node.js, AWS" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div><label style={labelStyle}>Company Size</label><input value={contact.companySize} onChange={e => setField('companySize', e.target.value)} style={inputStyle} placeholder="51-100" /></div>
                <div><label style={labelStyle}>Seniority</label><input value={contact.seniorityLevel} onChange={e => setField('seniorityLevel', e.target.value)} style={inputStyle} placeholder="director" /></div>
              </div>
              <div style={{ marginBottom: '16px' }}><label style={labelStyle}>Company Description</label><textarea value={contact.companyDescription} onChange={e => setField('companyDescription', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="What the company does..." /></div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: '#0f3460', color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px', fontWeight: '500'
                }}
              >
                {loading ? 'Generating...' : 'Generate Preview'}
              </button>
            </form>
          </div>
        </div>

        {/* Preview output */}
        <div>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', minHeight: '400px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#333' }}>Generated Email</h3>

            {error && (
              <div style={{ padding: '12px', borderRadius: '8px', background: '#f8d7da', color: '#721c24', fontSize: '13px', marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {!result && !loading && !error && (
              <div style={{ textAlign: 'center', padding: '48px', color: '#aaa' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>✉️</div>
                <p>Select a contact or fill in details, then click Generate</p>
              </div>
            )}

            {loading && (
              <div style={{ textAlign: 'center', padding: '48px', color: '#888' }}>
                <div style={{ fontSize: '20px', marginBottom: '12px' }}>Generating...</div>
                <p style={{ fontSize: '12px' }}>Calling OpenAI</p>
              </div>
            )}

            {result && (
              <div>
                <div style={{ border: '1px solid #e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ background: '#f8f9fa', padding: '12px 16px', borderBottom: '1px solid #e9ecef' }}>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>SUBJECT</div>
                    <div style={{ fontSize: '15px', fontWeight: '600', color: '#1a1a2e' }}>{result.subject}</div>
                  </div>
                  <div style={{ padding: '16px', fontSize: '13px', lineHeight: '1.8', whiteSpace: 'pre-wrap', color: '#333', minHeight: '200px' }}>
                    {result.body}
                  </div>
                </div>
                {result.tokens && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#aaa', textAlign: 'right' }}>
                    Tokens used: {result.tokens}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
