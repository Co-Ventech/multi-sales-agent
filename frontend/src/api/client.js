import axios from 'axios'

/** Default for normal API calls (ms). */
export const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30000

/** Apify scrape runs can take several minutes. */
export const SCRAPE_API_TIMEOUT_MS = Number(import.meta.env.VITE_SCRAPE_API_TIMEOUT_MS) || 600000

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: API_TIMEOUT_MS
})

// Response interceptor: redirect to /login on 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only redirect if not already on login page
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default apiClient
