import React, { useState, useEffect, useRef } from 'react'
import StatusBadge from './StatusBadge'

const STATUSES = ['all', 'Pending', 'Generated', 'Sent', 'Replied', 'Bounced', 'Failed', 'SpamBlocked', 'DryRun']

export default function ContactsTable({
  contacts = [],
  total = 0,
  page = 1,
  pages = 1,
  loading = false,
  onPageChange,
  onStatusFilter,
  onSearch,
  onRowClick,
  statusFilter = 'all',
  dateFilterUI = null
}) {
  const [searchVal, setSearchVal] = useState('')
  const debounceRef = useRef(null)

  const handleSearch = (val) => {
    setSearchVal(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearch && onSearch(val)
    }, 300)
  }

  return (
    <div>
      {dateFilterUI}
      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Status tabs */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => onStatusFilter && onStatusFilter(s)}
              style={{
                padding: '5px 12px',
                borderRadius: '16px',
                border: 'none',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                background: statusFilter === s ? '#0f3460' : '#e9ecef',
                color: statusFilter === s ? '#fff' : '#555',
                transition: 'all 0.15s'
              }}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchVal}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search email, name, company..."
          style={{
            padding: '6px 12px',
            borderRadius: '8px',
            border: '1px solid #ddd',
            fontSize: '13px',
            minWidth: '240px',
            marginLeft: 'auto'
          }}
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #e9ecef' }}>
              {['Email', 'Name', 'Company', 'Job Title', 'Status', 'Variant', 'Date Sent', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600', color: '#555', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#888' }}>Loading...</td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#888' }}>No contacts found</td>
              </tr>
            ) : (
              contacts.map((c, i) => (
                <tr
                  key={c._id}
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    background: i % 2 === 0 ? '#fff' : '#fafafa',
                    cursor: 'pointer',
                    transition: 'background 0.1s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa'}
                  onClick={() => onRowClick && onRowClick(c)}
                >
                  <td style={{ padding: '10px 16px', color: '#333', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.email}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#555' }}>
                    {[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#555', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.companyName || '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#555', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.jobTitle || '—'}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <StatusBadge status={c.status} />
                  </td>
                  <td style={{ padding: '10px 16px', color: '#888', textAlign: 'center' }}>
                    {c.abVariant ? (
                      <span style={{
                        padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700',
                        background: c.abVariant === 'A' ? '#d1e7dd' : '#fff3cd',
                        color: c.abVariant === 'A' ? '#0a3622' : '#856404'
                      }}>
                        {c.abVariant}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#888', fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {c.dateSent ? new Date(c.dateSent).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <button
                      style={{
                        padding: '4px 10px', fontSize: '11px', borderRadius: '6px',
                        border: '1px solid #0d6efd', background: '#fff', color: '#0d6efd',
                        cursor: 'pointer'
                      }}
                      onClick={e => { e.stopPropagation(); onRowClick && onRowClick(c); }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', fontSize: '13px', color: '#888' }}>
          <span>Showing {contacts.length} of {total} contacts</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              disabled={page <= 1}
              onClick={() => onPageChange && onPageChange(page - 1)}
              style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #ddd', background: '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}
            >
              Prev
            </button>
            <span style={{ padding: '6px 12px', fontWeight: '600', color: '#333' }}>
              {page} / {pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => onPageChange && onPageChange(page + 1)}
              style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #ddd', background: '#fff', cursor: page >= pages ? 'not-allowed' : 'pointer', opacity: page >= pages ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
