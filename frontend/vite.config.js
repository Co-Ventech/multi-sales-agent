import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 1200
  },
  optimizeDeps: {
    exclude: ['mermaid']
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000
      },
      '/c': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
