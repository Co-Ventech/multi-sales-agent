import React from 'react'
import Sidebar from './Sidebar'

const styles = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    background: '#f0f2f5'
  },
  content: {
    flex: 1,
    marginLeft: '260px',
    padding: '24px',
    overflowY: 'auto',
    minHeight: '100vh'
  }
}

export default function AppShell({ children }) {
  return (
    <div style={styles.shell}>
      <Sidebar />
      <main style={styles.content}>
        {children}
      </main>
    </div>
  )
}
