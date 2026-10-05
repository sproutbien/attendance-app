import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { installResponsiveTables } from './lib/responsiveTables'
import { applyBranding, cachedBranding } from './lib/brand'

installResponsiveTables()
// Before the first paint, so a re-branded app doesn't flash the default colours
applyBranding(cachedBranding())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
