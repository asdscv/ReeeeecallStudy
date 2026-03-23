import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { initWebPlatform } from './adapters'
import './index.css'
import './i18n'
import App from './App'

// Initialize platform adapters + Supabase before rendering
initWebPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <img src="/favicon.png" alt="" className="w-12 h-12 animate-pulse" />
      </div>
    }>
      <App />
    </Suspense>
  </StrictMode>,
)
