import React from 'react'

const STATUS_COLORS = {
  Pending:      { bg: '#e9ecef', color: '#495057' },
  Generated:    { bg: '#fff3cd', color: '#856404' },
  Sent:         { bg: '#d1e7dd', color: '#0a3622' },
  Failed:       { bg: '#ffe0d0', color: '#b94a00' },
  Bounced:      { bg: '#f8d7da', color: '#721c24' },
  Replied:      { bg: '#cfe2ff', color: '#084298' },
  Unsubscribed: { bg: '#e2e3e5', color: '#41464b' },
  SpamBlocked:  { bg: '#e8d5f5', color: '#5a1d99' },
  DryRun:       { bg: '#f0f0f0', color: '#888' }
}

export default function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] || { bg: '#e9ecef', color: '#495057' }

  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: '600',
      background: colors.bg,
      color: colors.color,
      whiteSpace: 'nowrap',
      letterSpacing: '0.3px'
    }}>
      {status || 'Unknown'}
    </span>
  )
}
