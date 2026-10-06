import React from 'react'

export default function StatsCard({ title, value, subtitle, color = '#0f3460', onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '20px 24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s, box-shadow 0.15s',
        borderTop: `3px solid ${color}`
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.transform = 'none')}
    >
      <div style={{ fontSize: '12px', color: '#888', fontWeight: '500', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {title}
      </div>
      <div style={{ fontSize: '32px', fontWeight: '700', color: color, lineHeight: 1 }}>
        {value ?? '—'}
      </div>
      {subtitle && (
        <div style={{ fontSize: '12px', color: '#aaa', marginTop: '6px' }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}
