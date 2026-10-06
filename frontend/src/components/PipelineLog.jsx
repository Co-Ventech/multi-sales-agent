import React, { useState, useEffect, useRef } from 'react'

const LEVEL_COLORS = {
  info: '#28a745',
  warn: '#fd7e14',
  error: '#dc3545',
  debug: '#6c757d'
}

export default function PipelineLog({ runId, onComplete }) {
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('running')
  const [results, setResults] = useState(null)
  const logEndRef = useRef(null)
  const eventSourceRef = useRef(null)

  useEffect(() => {
    if (!runId) return

    setLogs([])
    setStatus('running')
    setResults(null)

    const baseUrl = import.meta.env.VITE_API_URL
      ? import.meta.env.VITE_API_URL.replace('/api', '')
      : ''

    const url = `${baseUrl}/api${window.location.pathname.replace(/\/[^/]+$/, '')}/pipeline/logs/${runId}`

    // Use fetch-based polling as EventSource doesn't send cookies in all browsers
    // Instead, poll the history endpoint
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/brands/${getBrandIdFromPath()}/pipeline/logs/${runId}`, {
          credentials: 'include',
          headers: { 'Accept': 'text/event-stream' }
        })
      } catch {}
    }, 0)
    clearInterval(pollInterval)

    // Use native EventSource (SSE)
    const evtSource = new EventSource(`/api/brands/${getBrandIdFromPath()}/pipeline/logs/${runId}`, {
      withCredentials: true
    })

    eventSourceRef.current = evtSource

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'log') {
          setLogs(prev => [...prev, data])
        } else if (data.type === 'complete') {
          setStatus(data.status)
          setResults(data.results)
          evtSource.close()
          onComplete && onComplete(data)
        } else if (data.type === 'error') {
          setStatus('failed')
          evtSource.close()
        }
      } catch {}
    }

    evtSource.onerror = () => {
      evtSource.close()
    }

    return () => {
      evtSource.close()
    }
  }, [runId])

  // Auto-scroll to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  function getBrandIdFromPath() {
    const match = window.location.pathname.match(/\/brands\/([^/]+)/)
    return match ? match[1] : ''
  }

  return (
    <div>
      {/* Status indicator */}
      {status && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px'
        }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: status === 'running' ? '#fd7e14' : status === 'completed' ? '#28a745' : '#dc3545',
            display: 'inline-block',
            animation: status === 'running' ? 'pulse 1.5s infinite' : 'none'
          }} />
          <span style={{ fontSize: '12px', color: '#888', fontWeight: '500' }}>
            {status === 'running' ? 'Running...' : status === 'completed' ? 'Completed' : 'Failed'}
          </span>
        </div>
      )}

      {/* Log output */}
      <div style={{
        background: '#0d1117',
        borderRadius: '8px',
        padding: '16px',
        height: '400px',
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '1.6'
      }}>
        {logs.length === 0 && status === 'running' && (
          <div style={{ color: '#666' }}>Waiting for logs...</div>
        )}
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: '2px' }}>
            <span style={{ color: '#555', marginRight: '8px' }}>
              {log.time ? new Date(log.time).toLocaleTimeString() : ''}
            </span>
            <span style={{
              color: LEVEL_COLORS[log.level] || '#ccc',
              marginRight: '8px',
              fontWeight: '600',
              textTransform: 'uppercase',
              fontSize: '10px'
            }}>
              [{log.level}]
            </span>
            <span style={{ color: '#c9d1d9' }}>{log.message}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Results summary */}
      {results && (
        <div style={{
          marginTop: '12px', padding: '12px', background: '#f8f9fa',
          borderRadius: '8px', fontSize: '13px'
        }}>
          <strong>Results: </strong>
          {Object.entries(results)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' | ') || 'No results'}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.3; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
