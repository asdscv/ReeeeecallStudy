import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <img src="/favicon.png" alt="" className="w-12 h-12 animate-pulse" />
      </div>
    }>
      <App />
    </Suspense>
  </StrictMode>,
)
