import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import apiClient from '../../api/client'
import StatsCard from '../../components/StatsCard'
import StatusBadge from '../../components/StatusBadge'

function parseCronLabel(expr, tz) {
  if (!expr) return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { local: expr, pkt: null }
  const [min, hour, , , dow] = parts
  const days = dow === '*' ? 'Every day' : dow === '1-5' ? 'Mon–Fri' : dow === '0-4' ? 'Sun–Thu' : `Days ${dow}`
  const pad = n => String(n).padStart(2, '0')
  const tzOffsets = {
    'America/New_York': -5, 'America/Chicago': -6, 'America/Denver': -7,
    'America/Los_Angeles': -8, 'UTC': 0, 'Asia/Karachi': 5, 'Europe/London': 0, 'Asia/Dubai': 4
  }
  const srcOffset = tzOffsets[tz] ?? 0
  let pktHour = parseInt(hour) + (5 - srcOffset)
  if (pktHour >= 24) pktHour -= 24
  if (pktHour < 0) pktHour += 24
  return {
    local: `${days} at ${pad(hour)}:${pad(min)} (${tz || 'UTC'})`,
    pkt: `${pad(pktHour)}:${pad(min)} PKT`
  }
}

function getWeeklyMonthlyStats(costs) {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay())
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  let thisWeek = 0, lastWeek = 0, thisMonth = 0
  for (const { date, count } of costs) {
    const d = new Date(date)
    if (d >= monthStart) thisMonth += count
    if (d >= weekStart) thisWeek += count
    else if (d >= lastWeekStart) lastWeek += count
  }
  return { thisWeek, lastWeek, thisMonth }
}

export default function Overview() {
  const { brandId } = useParams()
  const [stats, setStats] = useState(null)
  const [costs, setCosts] = useState([])
  const [rotation, setRotation] = useState([])
  const [brand, setBrand] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [statsRes, costsRes, rotationRes, brandRes] = await Promise.allSettled([
        apiClient.get(`/brands/${brandId}/stats`),
        apiClient.get(`/brands/${brandId}/stats/costs`),
        apiClient.get(`/brands/${brandId}/stats/rotation`),
        apiClient.get(`/brands/${brandId}`)
      ])
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data)
      if (costsRes.status === 'fulfilled') setCosts(costsRes.value.data || [])
      if (rotationRes.status === 'fulfilled') setRotation(rotationRes.value.data)
      if (brandRes.status === 'fulfilled') setBrand(brandRes.value.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [brandId])

  if (loading) return <div style={{ padding: '32px', color: '#888' }}>Loading...</div>

  const s = stats || {}
  const replyRate = s.replyRate || 0
  const bounceRate = s.bounceRate || 0
  const { thisWeek, lastWeek, thisMonth } = getWeeklyMonthlyStats(costs)
  const weekTrend = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e' }}>Overview</h1>
        <button onClick={fetchData} style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>
          Refresh
        </button>
      </div>

      {/* Cron schedule banner */}
      {brand?.cron?.enabled && (() => {
        const send = parseCronLabel(brand.cron.sendEmails, brand.cron.timezone)
        const generate = parseCronLabel(brand.cron.generateEmails, brand.cron.timezone)
        const bounces = parseCronLabel(brand.cron.checkBounces, brand.cron.timezone)
        const queue = (s.byStatus?.Generated ?? 0) + (s.byStatus?.Pending ?? 0)
        return (
          <div style={{ background: '#f0f7ff', border: '1px solid #b8d4f0', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#0f3460', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.5px' }}>Automated Schedule</div>
            <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
              {generate?.local && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: '3px' }}>Generate</div>
                  <div style={{ fontSize: '13px', color: '#0f3460', fontWeight: '600' }}>{generate.local}</div>
                  {generate.pkt && <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>{generate.pkt} (your time)</div>}
                </div>
              )}
              {send?.local && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: '3px' }}>Send</div>
                  <div style={{ fontSize: '13px', color: '#0f3460', fontWeight: '600' }}>{send.local}</div>
                  {send.pkt && <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>{send.pkt} (your time)</div>}
                </div>
              )}
              {bounces?.local && (
                <div>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: '3px' }}>Bounce Check</div>
                  <div style={{ fontSize: '13px', color: '#0f3460', fontWeight: '600' }}>{bounces.local}</div>
                  {bounces.pkt && <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>{bounces.pkt} (your time)</div>}
                </div>
              )}
              <div>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: '3px' }}>In Queue</div>
                <div style={{ fontSize: '13px', color: queue > 0 ? '#198754' : '#aaa', fontWeight: '600' }}>{queue} contacts</div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>ready for next send</div>
              </div>
            </div>
          </div>
        )
      })()}
      {brand?.cron && !brand.cron.enabled && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '10px', padding: '10px 16px', marginBottom: '24px', fontSize: '13px', color: '#7a5500' }}>
          Auto-scheduling is <strong>off</strong>. Go to Settings to enable, or use Pipeline page to run manually.
        </div>
      )}

      {/* Primary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        <StatsCard title="Total Contacts" value={s.total ?? 0} color="#0f3460" />
        <StatsCard title="Total Emails Sent" value={s.totalEmailsSent ?? 0} color="#17a2b8" />
        <StatsCard title="Ready to Send" value={(s.byStatus?.Generated ?? 0) + (s.byStatus?.Pending ?? 0)} color="#0d6efd" />
        <StatsCard title="Sent Today" value={s.sentToday ?? 0} color="#198754" />
        <StatsCard title="Sent Yesterday" value={s.sentYesterday ?? 0} color="#0d6efd" />
        <StatsCard title="Replied" value={s.byStatus?.Replied ?? 0} color="#6610f2" />
        <StatsCard title="Reply Rate" value={`${replyRate}%`} color="#6610f2" />
        <StatsCard title="Bounce Rate" value={`${s.bounceRate ?? 0}%`} color="#dc3545" />
      </div>

      {/* Weekly / Monthly */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'This Week', value: thisWeek, sub: lastWeek > 0 ? `Last week: ${lastWeek}${weekTrend !== null ? ` (${weekTrend > 0 ? '+' : ''}${weekTrend}%)` : ''}` : 'No data last week' },
          { label: 'Last Week', value: lastWeek, sub: 'Emails sent' },
          { label: 'This Month', value: thisMonth, sub: 'Total sent this month' }
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a2e' }}>{value}</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Status breakdown */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#555' }}>Status Breakdown</h3>
          {Object.entries(s.byStatus || {}).filter(([, v]) => v > 0).map(([status, count]) => (
            <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <StatusBadge status={status} />
              <span style={{ fontWeight: '600', color: '#333' }}>{count}</span>
            </div>
          ))}
          {(!s.byStatus || Object.values(s.byStatus).every(v => v === 0)) && (
            <p style={{ color: '#aaa', fontSize: '13px' }}>No contacts yet</p>
          )}
        </div>

        {/* SMTP Rotation Today */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', color: '#555' }}>SMTP Rotation Today</h3>
          {rotation.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: '13px' }}>No SMTP accounts configured</p>
          ) : rotation.map(acct => {
            const pct = acct.dailyLimit > 0 ? Math.min(100, Math.round((acct.todayCount / acct.dailyLimit) * 100)) : 0
            const barColor = pct >= 100 ? '#dc3545' : pct >= 80 ? '#fd7e14' : '#198754'
            return (
              <div key={acct.accountId} style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span style={{ color: '#555', fontWeight: '500' }}>{acct.fromEmail}</span>
                  <span style={{ color: barColor, fontWeight: '600' }}>{acct.todayCount}/{acct.dailyLimit}</span>
                </div>
                <div style={{ height: '5px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '3px' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
