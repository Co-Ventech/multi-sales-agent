import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient from '../api/client'

export default function Dashboard() {
  const [brands, setBrands] = useState([])
  const [brandStats, setBrandStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const fetchBrands = async () => {
    setLoading(true)
    try {
      const res = await apiClient.get('/brands')
      setBrands(res.data)
      // Fetch stats for each brand in parallel
      const statsResults = await Promise.allSettled(
        res.data.map(b => apiClient.get(`/brands/${b._id}/stats`).then(r => ({ id: b._id, data: r.data })))
      )
      const statsMap = {}
      statsResults.forEach(r => { if (r.status === 'fulfilled') statsMap[r.value.id] = r.value.data })
      setBrandStats(statsMap)
    } catch (err) {
      console.error('Failed to load brands', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBrands() }, [])

  const createBrand = async (e) => {
    e.preventDefault()
    if (!newBrandName.trim()) return
    setCreating(true)
    try {
      const res = await apiClient.post('/brands', { name: newBrandName.trim() })
      setBrands(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewBrandName('')
      setShowModal(false)
      navigate(`/brands/${res.data._id}/overview`)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create brand')
    } finally {
      setCreating(false)
    }
  }

  const runAction = async (brandId, action) => {
    try {
      const res = await apiClient.post(`/brands/${brandId}/pipeline/run`, { action })
      navigate(`/brands/${brandId}/pipeline`)
    } catch (err) {
      alert(err.response?.data?.error || `Failed to start ${action}`)
    }
  }

  if (loading) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#888' }}>Loading brands...</div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1a1a2e' }}>Dashboard</h1>
          <p style={{ color: '#888', fontSize: '14px', marginTop: '4px' }}>{brands.length} brand(s) configured</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: '10px 20px', borderRadius: '8px', border: 'none',
            background: '#0f3460', color: '#fff', cursor: 'pointer',
            fontSize: '14px', fontWeight: '500'
          }}
        >
          + Create Brand
        </button>
      </div>

      {brands.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px', background: '#fff',
          borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✉️</div>
          <h2 style={{ fontSize: '20px', marginBottom: '8px', color: '#333' }}>No brands yet</h2>
          <p style={{ color: '#888', marginBottom: '24px' }}>Create your first brand to start sending outreach emails</p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              padding: '12px 24px', borderRadius: '8px', border: 'none',
              background: '#0f3460', color: '#fff', cursor: 'pointer', fontSize: '14px'
            }}
          >
            Create First Brand
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {brands.map(brand => {
            const stats = brandStats[brand._id] || {}
            return (
              <div
                key={brand._id}
                style={{
                  background: '#fff', borderRadius: '12px', padding: '24px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  borderTop: `3px solid ${brand.isActive ? '#0f3460' : '#aaa'}`
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a2e', marginBottom: '4px' }}>
                      {brand.name}
                    </h3>
                    <span style={{ fontSize: '11px', color: '#888' }}>{brand.slug}</span>
                  </div>
                  <span style={{
                    padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600',
                    background: brand.isActive ? '#d1e7dd' : '#e9ecef',
                    color: brand.isActive ? '#0a3622' : '#6c757d'
                  }}>
                    {brand.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  {[
                    { label: 'Total', value: stats.total ?? 0 },
                    { label: 'Sent Today', value: stats.sentToday ?? 0 },
                    { label: 'Replied', value: stats.byStatus?.Replied ?? 0 }
                  ].map(({ label, value }) => (
                    <div key={label} style={{ textAlign: 'center', padding: '8px', background: '#f8f9fa', borderRadius: '8px' }}>
                      <div style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a2e' }}>{value}</div>
                      <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', marginTop: '2px' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => navigate(`/brands/${brand._id}/overview`)}
                    style={{
                      flex: 1, padding: '8px', fontSize: '12px', borderRadius: '6px',
                      border: '1px solid #0f3460', background: '#fff', color: '#0f3460',
                      cursor: 'pointer'
                    }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => navigate(`/brands/${brand._id}/contacts`)}
                    style={{
                      flex: 1, padding: '8px', fontSize: '12px', borderRadius: '6px',
                      border: '1px solid #6c757d', background: '#fff', color: '#6c757d',
                      cursor: 'pointer'
                    }}
                  >
                    Contacts
                  </button>
                  <button
                    onClick={() => runAction(brand._id, 'send')}
                    style={{
                      flex: 1, padding: '8px', fontSize: '12px', borderRadius: '6px',
                      border: 'none', background: '#0f3460', color: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    Send
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Brand Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '28px', width: '380px' }}>
            <h3 style={{ marginBottom: '20px', fontSize: '18px' }}>Create New Brand</h3>
            <form onSubmit={createBrand}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#555', marginBottom: '6px' }}>Brand Name</label>
                <input
                  type="text"
                  value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)}
                  placeholder="My Brand Name"
                  autoFocus
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '14px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={creating} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#0f3460', color: '#fff', cursor: 'pointer' }}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
