import React from 'react'

export default function SmtpCard({ account, onTest, onEdit, onDelete }) {
  const pct = account.dailyLimit > 0
    ? Math.min(100, Math.round((account.todayCount / account.dailyLimit) * 100))
    : 0

  const barColor = pct >= 100 ? '#dc3545' : pct >= 80 ? '#fd7e14' : '#198754'

  return (
    <div style={{
      background: '#fff',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      borderLeft: `4px solid ${account.isActive ? '#198754' : '#aaa'}`
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>
            {account.fromEmail}
          </div>
          {account.senderName && (
            <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
              {account.senderName}
            </div>
          )}
        </div>
        <span style={{
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: '600',
          background: account.isActive ? '#d1e7dd' : '#e9ecef',
          color: account.isActive ? '#0a3622' : '#6c757d'
        }}>
          {account.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Daily limit progress bar */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginBottom: '4px' }}>
          <span>Today's sends</span>
          <span style={{ fontWeight: '600', color: barColor }}>
            {account.todayCount ?? 0} / {account.dailyLimit}
          </span>
        </div>
        <div style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: barColor,
            borderRadius: '3px',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => onTest(account)}
          style={{
            flex: 1, padding: '6px 8px', fontSize: '12px', borderRadius: '6px',
            border: '1px solid #0d6efd', background: '#fff', color: '#0d6efd',
            cursor: 'pointer'
          }}
        >
          Test
        </button>
        <button
          onClick={() => onEdit(account)}
          style={{
            flex: 1, padding: '6px 8px', fontSize: '12px', borderRadius: '6px',
            border: '1px solid #6c757d', background: '#fff', color: '#6c757d',
            cursor: 'pointer'
          }}
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(account)}
          style={{
            flex: 1, padding: '6px 8px', fontSize: '12px', borderRadius: '6px',
            border: '1px solid #dc3545', background: '#fff', color: '#dc3545',
            cursor: 'pointer'
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
