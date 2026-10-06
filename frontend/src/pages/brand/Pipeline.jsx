import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import apiClient from '../../api/client'

const LEVEL_COLORS = { info: '#28a745', warn: '#fd7e14', error: '#dc3545', debug: '#6c757d' }

const ACTIONS = [
  { action: 'generate', label: 'Generate Emails', color: '#6610f2', desc: 'AI writes emails for Pending contacts. Does NOT send.' },
  { action: 'send', label: 'Send Emails', color: '#0f3460', desc: 'Send all Generated contacts. Respects daily limit.', danger: true },
  { action: 'follow-ups', label: 'Send Follow-ups', color: '#17a2b8', desc: 'Send one follow-up to Sent contacts who have not replied or bounced (after configured days).', danger: true },
  { action: 'scrape-leads', label: 'Scrape Leads (Apify)', color: '#20c997', desc: 'Run the saved Apify filter and auto-import qualified leads.' },
  { action: 'check-bounces', label: 'Check Bounces', color: '#fd7e14', desc: 'Scan IMAP inboxes for bounces and replies' },
  { action: 'dry-run', label: 'Dry Run', color: '#6c757d', desc: 'Simulate send — no emails go out. Safe to test.' }
]

export default function Pipeline() {
  const { brandId } = useParams()
  const [currentRun, setCurrentRun] = useState(null)
  const [history, setHistory] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [runningAction, setRunningAction] = useState(null)
  const [importFile, setImportFile] = useState(null)
  const [generateLimit, setGenerateLimit] = useState('')
  const [pendingCount, setPendingCount] = useState(null)
  const [generatedCount, setGeneratedCount] = useState(null)
  const [stopping, setStopping] = useState(false)
  const logEndRef = useRef(null)
  const sseRef = useRef(null)

  const fetchStatus = async () => {
    try {
      const [statusRes, histRes, pendingRes, generatedRes] = await Promise.allSettled([
        apiClient.get(`/brands/${brandId}/pipeline/status`),
        apiClient.get(`/brands/${brandId}/pipeline/history`),
        apiClient.get(`/brands/${brandId}/contacts`, { params: { status: 'Pending', limit: 1 } }),
        apiClient.get(`/brands/${brandId}/contacts`, { params: { status: 'Generated', limit: 1 } })
      ])
      if (statusRes.status === 'fulfilled') setCurrentRun(statusRes.value.data)
      if (histRes.status === 'fulfilled') setHistory(histRes.value.data)
      if (pendingRes.status === 'fulfilled') setPendingCount(pendingRes.value.data.total)
      if (generatedRes.status === 'fulfilled') setGeneratedCount(generatedRes.value.data.total)
    } catch {}
  }

  useEffect(() => {
    fetchStatus()
  }, [brandId])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const startSSE = (runId) => {
    if (sseRef.current) sseRef.current.close()
    setLogs([])

    const evtSource = new EventSource(`/api/brands/${brandId}/pipeline/logs/${runId}`, { withCredentials: true })
    sseRef.current = evtSource

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'log') {
          setLogs(prev => [...prev, data])
        } else if (data.type === 'complete') {
          setRunningAction(null)
          evtSource.close()
          fetchStatus()
        } else if (data.type === 'error') {
          setRunningAction(null)
          evtSource.close()
          fetchStatus()
        }
      } catch {}
    }

    evtSource.onerror = () => {
      evtSource.close()
      setRunningAction(null)
      fetchStatus()
    }
  }

  const handleRun = async (action) => {
    if (action === 'send') {
      const count = generatedCount ?? 0
      const confirmed = window.confirm(
        `Send emails to ${count} Generated contact${count !== 1 ? 's' : ''}?\n\nThis will send real emails. Daily limit applies.`
      )
      if (!confirmed) return
    }

    setRunningAction(action)
    setLogs([])
    try {
      let res
      if (action === 'import' && importFile) {
        const formData = new FormData()
        formData.append('file', importFile)
        formData.append('action', 'import')
        res = await apiClient.post(`/brands/${brandId}/pipeline/run`, formData)
      } else {
        const body = { action }
        if (action === 'generate' && generateLimit) body.limit = parseInt(generateLimit)
        res = await apiClient.post(`/brands/${brandId}/pipeline/run`, body)
      }
      startSSE(res.data.runId)
      fetchStatus()
    } catch (err) {
      alert(err.response?.data?.error || `Failed to start ${action}`)
      setRunningAction(null)
    }
  }

  const handleStop = async () => {
    if (!window.confirm('Stop the running pipeline? Emails already sent in this run will not be undone.')) return
    setStopping(true)
    try {
      await apiClient.post(`/brands/${brandId}/pipeline/stop`)
      setRunningAction(null)
      if (sseRef.current) sseRef.current.close()
      fetchStatus()
    } catch (err) {
      alert(err.response?.data?.error || 'Stop failed')
    } finally {
      setStopping(false)
    }
  }

  const formatDuration = (start, end) => {
    if (!start || !end) return '—'
    const ms = new Date(end) - new Date(start)
    if (ms < 60000) return `${Math.round(ms / 1000)}s`
    return `${Math.round(ms / 60000)}m`
  }

  const statusColor = (s) => ({ running: '#fd7e14', completed: '#198754', failed: '#dc3545' }[s] || '#888')

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a2e', marginBottom: '24px' }}>Pipeline</h1>

      {/* Import file upload */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ fontSize: '13px', color: '#555', fontWeight: '500' }}>Import JSON file:</span>
        <label style={{
          padding: '6px 14px', borderRadius: '8px', border: '1px dashed #0d6efd',
          color: '#0d6efd', cursor: 'pointer', fontSize: '13px'
        }}>
          {importFile ? importFile.name : 'Choose File'}
          <input type="file" accept=".json" onChange={e => setImportFile(e.target.files[0])} style={{ display: 'none' }} />
        </label>
        {importFile && (
          <button onClick={() => handleRun('import')} disabled={!!runningAction} style={{
            padding: '6px 16px', borderRadius: '8px', border: 'none',
            background: '#198754', color: '#fff', cursor: 'pointer', fontSize: '13px'
          }}>
            Import Now
          </button>
        )}
      </div>

      {/* Generate limit input */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ fontSize: '13px', color: '#555', fontWeight: '500' }}>Generate emails for:</span>
        <input
          type="number"
          min="1"
          max="500"
          value={generateLimit}
          onChange={e => setGenerateLimit(e.target.value)}
          placeholder="All pending"
          style={{ width: '130px', padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}
        />
        <span style={{ fontSize: '12px', color: '#aaa' }}>contacts (leave empty = all pending)</span>
      </div>

      {/* Queue status */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', fontSize: '13px', color: '#555' }}>
          <span style={{ fontWeight: '700', color: '#6610f2', fontSize: '16px' }}>{pendingCount ?? '—'}</span> Pending (ready to generate)
        </div>
        <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', fontSize: '13px', color: '#555' }}>
          <span style={{ fontWeight: '700', color: '#0f3460', fontSize: '16px' }}>{generatedCount ?? '—'}</span> Generated (ready to send)
        </div>
        {runningAction && (
          <button onClick={handleStop} disabled={stopping} style={{
            marginLeft: 'auto', padding: '8px 18px', borderRadius: '8px', border: 'none',
            background: '#dc3545', color: '#fff', cursor: stopping ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: '700'
          }}>
            {stopping ? 'Stopping...' : '⏹ Stop Pipeline'}
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        {ACTIONS.map(({ action, label, color, desc, danger }) => (
          <button
            key={action}
            onClick={() => handleRun(action)}
            disabled={!!runningAction}
            style={{
              padding: '14px 16px', borderRadius: '12px',
              border: danger ? '2px solid rgba(255,255,255,0.3)' : 'none',
              background: runningAction === action ? '#ccc' : color,
              color: '#fff', cursor: runningAction ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: '600', textAlign: 'left',
              lineHeight: '1.4', opacity: runningAction && runningAction !== action ? 0.5 : 1,
              transition: 'opacity 0.15s'
            }}
          >
            <div>{runningAction === action ? 'Running...' : label}</div>
            <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px', fontWeight: '400' }}>{desc}</div>
          </button>
        ))}
      </div>

      {/* Live log output */}
      {(logs.length > 0 || runningAction) && (
        <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Live Log</h3>
            {runningAction && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#fd7e14' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fd7e14', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                Running: {runningAction}
              </span>
            )}
          </div>
          <div style={{
            background: '#0d1117', borderRadius: '8px', padding: '16px',
            height: '360px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.7'
          }}>
            {logs.map((log, i) => (
              <div key={i}>
                <span style={{ color: '#555', marginRight: '8px' }}>{log.time ? new Date(log.time).toLocaleTimeString() : ''}</span>
                <span style={{ color: LEVEL_COLORS[log.level] || '#ccc', marginRight: '8px', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase' }}>[{log.level}]</span>
                <span style={{ color: '#c9d1d9' }}>{log.message}</span>
              </div>
            ))}
            {logs.length === 0 && <span style={{ color: '#555' }}>Waiting for logs...</span>}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Run history */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#333', marginBottom: '16px' }}>Run History</h3>
        {history.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: '13px' }}>No runs yet</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f0f0f0' }}>
                {['Action', 'Status', 'Started', 'Duration', 'Generated', 'Sent', 'Failed', 'Bounces', 'Replies'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#888', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map(run => (
                <tr key={run._id} style={{ borderBottom: '1px solid #f8f8f8' }}>
                  <td style={{ padding: '10px', fontWeight: '600', color: '#333' }}>{run.action}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600', background: run.status === 'completed' ? '#d1e7dd' : run.status === 'running' ? '#fff3cd' : '#f8d7da', color: statusColor(run.status) }}>
                      {run.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px', color: '#888' }}>{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</td>
                  <td style={{ padding: '10px', color: '#888' }}>{formatDuration(run.startedAt, run.completedAt)}</td>
                  <td style={{ padding: '10px', color: '#6610f2', fontWeight: run.results?.generated > 0 ? '600' : '400' }}>{run.results?.generated ?? 0}</td>
                  <td style={{ padding: '10px', color: '#198754', fontWeight: run.results?.sent > 0 ? '600' : '400' }}>{run.results?.sent ?? 0}</td>
                  <td style={{ padding: '10px', color: '#dc3545' }}>{run.results?.failed ?? 0}</td>
                  <td style={{ padding: '10px', color: '#fd7e14' }}>{run.results?.bounces ?? 0}</td>
                  <td style={{ padding: '10px', color: '#0d6efd' }}>{run.results?.replies ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>
    </div>
  )
}
