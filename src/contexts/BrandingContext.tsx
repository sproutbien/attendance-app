import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { applyBranding, cachedBranding, fetchBranding, iconUrl, logoUrl } from '../lib/brand'
import type { Branding } from '../lib/brand'

type BrandingValue = {
  branding: Branding
  logo: string
  icon: string
  /** Re-reads the branding row, e.g. after the superadmin saves. */
  refresh: () => Promise<void>
}

const BrandingContext = createContext<BrandingValue | null>(null)

/**
 * Starts from the copy cached in this browser (so a reload doesn't flash the
 * default brand), then loads the current branding.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding>(cachedBranding)

  const refresh = useCallback(async () => {
    const b = await fetchBranding()
    if (b) setBranding(b)
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { applyBranding(branding) }, [branding])

  return (
    <BrandingContext.Provider value={{ branding, logo: logoUrl(branding), icon: iconUrl(branding), refresh }}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  const ctx = useContext(BrandingContext)
  if (!ctx) throw new Error('useBranding must be used inside BrandingProvider')
  return ctx
}
