import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AppShell from './components/Layout/AppShell'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Overview from './pages/brand/Overview'
import Contacts from './pages/brand/Contacts'
import Campaign from './pages/brand/Campaign'
import AbTest from './pages/brand/AbTest'
import SmtpAccounts from './pages/brand/SmtpAccounts'
import Preview from './pages/brand/Preview'
import Pipeline from './pages/brand/Pipeline'
import Settings from './pages/brand/Settings'
import Apify from './pages/brand/Apify'
import BlogDashboard from './pages/brand/BlogDashboard'
import LinkedInScraper from './pages/brand/LinkedInScraper'
import UpworkScraper from './pages/brand/UpworkScraper'
import TwitterJobs from './pages/brand/TwitterJobs'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>Loading...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppShell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/brands/:brandId/overview" element={<Overview />} />
                <Route path="/brands/:brandId/contacts" element={<Contacts />} />
                <Route path="/brands/:brandId/campaign" element={<Campaign />} />
                <Route path="/brands/:brandId/ab-test" element={<AbTest />} />
                <Route path="/brands/:brandId/smtp" element={<SmtpAccounts />} />
                <Route path="/brands/:brandId/preview" element={<Preview />} />
                <Route path="/brands/:brandId/pipeline" element={<Pipeline />} />
                <Route path="/brands/:brandId/settings" element={<Settings />} />
                <Route path="/brands/:brandId/apify" element={<Apify />} />
                <Route path="/brands/:brandId/scraper/linkedin" element={<LinkedInScraper />} />
                <Route path="/brands/:brandId/scraper/upwork" element={<UpworkScraper />} />
                <Route path="/brands/:brandId/blog-dashboard" element={<BlogDashboard />} />
                <Route path="/blog-dashboard" element={<BlogDashboard />} />
                <Route path="/brands/:brandId/twitter-jobs" element={<TwitterJobs />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
