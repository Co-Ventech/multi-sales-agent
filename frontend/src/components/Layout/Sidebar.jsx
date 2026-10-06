import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import apiClient from '../../api/client'

const styles = {
  sidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '260px',
    height: '100vh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    zIndex: 100,
    boxShadow: '2px 0 8px rgba(0,0,0,0.3)'
  },
  header: {
    padding: '20px 16px',
    borderBottom: '1px solid #2a2a4a',
    background: '#16213e'
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#fff',
    letterSpacing: '0.5px'
  },
  headerSub: {
    fontSize: '11px',
    color: '#8888aa',
    marginTop: '2px'
  },
  section: {
    padding: '8px 0'
  },
  sectionLabel: {
    fontSize: '10px',
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    padding: '8px 16px 4px'
  },
  brandItem: {
    cursor: 'pointer',
    borderBottom: '1px solid #1e1e3a'
  },
  brandHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    cursor: 'pointer',
    transition: 'background 0.15s'
  },
  brandName: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#c0c0d0'
  },
  brandArrow: {
    fontSize: '10px',
    color: '#666',
    transition: 'transform 0.2s'
  },
  navLinks: {
    paddingLeft: '0',
    paddingBottom: '4px',
    background: '#111128'
  },
  navLink: {
    display: 'block',
    padding: '7px 16px 7px 32px',
    fontSize: '12px',
    color: '#9090b0',
    textDecoration: 'none',
    transition: 'background 0.1s, color 0.1s'
  },
  navLinkActive: {
    color: '#6eb5ff',
    background: 'rgba(110,181,255,0.1)'
  },
  scraperSection: {
    paddingLeft: '0',
    paddingBottom: '4px'
  },
  scraperLabel: {
    fontSize: '10px',
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    padding: '8px 16px 4px'
  },
  scraperSub: {
    display: 'block',
    padding: '7px 16px 7px 32px',
    fontSize: '12px',
    color: '#9090b0',
    textDecoration: 'none',
    transition: 'background 0.1s, color 0.1s'
  },
  scraperSubActive: {
    color: '#6eb5ff',
    background: 'rgba(110,181,255,0.1)'
  },
  newBrandBtn: {
    display: 'block',
    margin: '8px 16px',
    padding: '8px 12px',
    background: '#0f3460',
    color: '#6eb5ff',
    border: '1px dashed #2a5a90',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    textAlign: 'center',
    transition: 'background 0.15s'
  },
  footer: {
    marginTop: 'auto',
    padding: '16px',
    borderTop: '1px solid #2a2a4a'
  },
  logoutBtn: {
    width: '100%',
    padding: '8px',
    background: 'transparent',
    border: '1px solid #444',
    borderRadius: '6px',
    color: '#888',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.15s'
  }
}

const NAV_LINKS = [
  { label: 'Overview', path: 'overview' },
  { label: 'Contacts', path: 'contacts' },
  { label: 'SMTP Accounts', path: 'smtp' },
  { label: 'Preview', path: 'preview' },
  { label: 'Pipeline', path: 'pipeline' },
  { label: 'A/B Testing', path: 'ab-test' },
  { label: 'Apify', path: 'apify' },
  { label: 'Settings', path: 'settings' }
]

// Per-scraper brand mapping (LinkedIn vs Upwork use different brands). Match by name first, then env/fallback IDs.
const SCRAPER_BRAND_FALLBACK = {
  linkedin: import.meta.env.VITE_SCRAPER_LINKEDIN_BRAND_ID || '69fc7ee6d7bc81d1c8986355',
  upwork: import.meta.env.VITE_SCRAPER_UPWORK_BRAND_ID || '6a0c1d61673660197dbf20e3'
}

function normalizeBrandName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findBrandIdByName(brands, ...namePatterns) {
  const patterns = namePatterns.map(normalizeBrandName)
  const match = brands.find(b => {
    const n = normalizeBrandName(b.name)
    return patterns.some(p => n === p || n.includes(p))
  })
  return match?._id || null
}

function resolveScraperBrandIds(brands) {
  // Prefer the brand that actually consumes the Upwork MCP provider: jobs
  // scraped through the upwork-mcp workflow are stored under that brand, so
  // routing the scraper there is what makes newly upserted MCP jobs appear in
  // the list and update the "All" counter. Falls back to the existing logic.
  const upworkMcpBrand =
    brands.find(b => b.apify?.provider === 'mcp' && normalizeBrandName(b.name).includes('upwork'))?._id || null
  const linkedin =
    findBrandIdByName(brands, 'linkedin') || SCRAPER_BRAND_FALLBACK.linkedin
  const upwork =
    upworkMcpBrand || findBrandIdByName(brands, 'upwork') || SCRAPER_BRAND_FALLBACK.upwork
  const twitter =
    findBrandIdByName(brands, 'twitter') || upwork
  return { linkedin, upwork, twitter }
}

export default function Sidebar() {
  const [brands, setBrands] = useState([])
  const [expandedBrand, setExpandedBrand] = useState(null)
  const [showNewBrandModal, setShowNewBrandModal] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [creating, setCreating] = useState(false)
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const fetchBrands = async () => {
    try {
      const res = await apiClient.get('/brands')
      setBrands(res.data)
      const match = location.pathname.match(/\/brands\/([^/]+)/)
      if (match) setExpandedBrand(match[1])
    } catch {}
  }

  useEffect(() => { fetchBrands() }, [])

  useEffect(() => {
    const match = location.pathname.match(/\/brands\/([^/]+)/)
    if (match) setExpandedBrand(match[1])
  }, [location.pathname])

  const toggleBrand = (brandId) => {
    if (expandedBrand === brandId) {
      setExpandedBrand(null)
    } else {
      setExpandedBrand(brandId)
      const scraperMatch = location.pathname.match(/\/scraper\/(\w+)/)
      if (scraperMatch) {
        navigate(`/brands/${brandId}/scraper/${scraperMatch[1]}`)
      } else if (location.pathname.includes('/twitter-jobs')) {
        const { twitter } = resolveScraperBrandIds(brands)
        navigate(`/brands/${twitter || brandId}/twitter-jobs`)
      } else {
        navigate(`/brands/${brandId}/overview`)
      }
    }
  }

  const createBrand = async (e) => {
    e.preventDefault()
    if (!newBrandName.trim()) return
    setCreating(true)
    try {
      const res = await apiClient.post('/brands', { name: newBrandName.trim() })
      setBrands(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewBrandName('')
      setShowNewBrandModal(false)
      navigate(`/brands/${res.data._id}/overview`)
      setExpandedBrand(res.data._id)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create brand')
    } finally {
      setCreating(false)
    }
  }

  const isActiveLink = (brandId, path) => {
    return location.pathname === `/brands/${brandId}/${path}`
  }

  const scraperBrands = resolveScraperBrandIds(brands)
  const showScrapers = scraperBrands.linkedin || scraperBrands.upwork || scraperBrands.twitter

  return (
    <>
      <nav style={styles.sidebar}>
        <div style={styles.header}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <div style={styles.headerTitle}>Email Agent</div>
            <div style={styles.headerSub}>Multi-Brand Outreach</div>
          </Link>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionLabel}>Brands</div>

          {brands.map(brand => (
            <div key={brand._id} style={styles.brandItem}>
              <div
                style={{
                  ...styles.brandHeader,
                  background: expandedBrand === brand._id ? '#1e1e3a' : 'transparent'
                }}
                onClick={() => toggleBrand(brand._id)}
              >
                <span style={{
                  ...styles.brandName,
                  color: expandedBrand === brand._id ? '#fff' : '#c0c0d0'
                }}>
                  {brand.name}
                </span>
                <span style={{
                  ...styles.brandArrow,
                  transform: expandedBrand === brand._id ? 'rotate(90deg)' : 'none'
                }}>
                  ▶
                </span>
              </div>

              {expandedBrand === brand._id && (
                <div style={styles.navLinks}>
                  {NAV_LINKS.map(link => (
                    <Link
                      key={link.path}
                      to={`/brands/${brand._id}/${link.path}`}
                      style={{
                        ...styles.navLink,
                        ...(isActiveLink(brand._id, link.path) ? styles.navLinkActive : {})
                      }}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          <button
            style={styles.newBrandBtn}
            onClick={() => setShowNewBrandModal(true)}
          >
            + New Brand
          </button>
        </div>

        <div style={{ borderTop: '1px solid #2a2a4a', margin: '4px 0' }} />

        {showScrapers && (
          <div style={styles.section}>
            <div style={styles.scraperLabel}>Scraper</div>
            <div style={styles.scraperSection}>
              <Link
                to={`/brands/${scraperBrands.linkedin}/scraper/linkedin`}
                style={{
                  ...styles.scraperSub,
                  ...(location.pathname.includes('/scraper/linkedin') ? styles.scraperSubActive : {})
                }}
              >
                LinkedIn
              </Link>
              <Link
                to={`/brands/${scraperBrands.upwork}/scraper/upwork`}
                style={{
                  ...styles.scraperSub,
                  ...(location.pathname.includes('/scraper/upwork') ? styles.scraperSubActive : {})
                }}
              >
                Upwork
              </Link>
              <Link
                to={`/brands/${scraperBrands.twitter}/twitter-jobs`}
                style={{
                  ...styles.scraperSub,
                  ...(location.pathname.includes('/twitter-jobs') ? styles.scraperSubActive : {})
                }}
              >
                Twitter Jobs
              </Link>
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid #2a2a4a', margin: '4px 0' }} />

        <div style={styles.section}>
          <div style={styles.sectionLabel}>Tools</div>
          <Link
            to="/blog-dashboard"
            style={{
              ...styles.navLink,
              paddingLeft: '16px',
              ...(location.pathname === '/blog-dashboard' ? styles.navLinkActive : {})
            }}
          >
            Blog Pipeline
          </Link>
        </div>

        <div style={styles.footer}>
          <button
            style={styles.logoutBtn}
            onClick={logout}
            onMouseEnter={e => { e.target.style.color = '#e0e0e0'; e.target.style.borderColor = '#888' }}
            onMouseLeave={e => { e.target.style.color = '#888'; e.target.style.borderColor = '#444' }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      {showNewBrandModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '24px',
            width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }}>
            <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Create New Brand</h3>
            <form onSubmit={createBrand}>
              <input
                type="text"
                value={newBrandName}
                onChange={e => setNewBrandName(e.target.value)}
                placeholder="Brand name..."
                autoFocus
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px',
                  border: '1px solid #ddd', fontSize: '14px', marginBottom: '16px'
                }}
              />
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setShowNewBrandModal(false); setNewBrandName('') }}
                  style={{
                    padding: '8px 16px', borderRadius: '8px', border: '1px solid #ddd',
                    background: '#fff', cursor: 'pointer', fontSize: '13px'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newBrandName.trim()}
                  style={{
                    padding: '8px 16px', borderRadius: '8px', border: 'none',
                    background: '#0f3460', color: '#fff', cursor: 'pointer', fontSize: '13px'
                  }}
                >
                  {creating ? 'Creating...' : 'Create Brand'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}