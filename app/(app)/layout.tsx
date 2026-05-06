import { ThemeProvider } from '@/components/theme-provider'
import { StaxAppShell } from '@/components/cockpit/stax/StaxDashboard'

/**
 * App shell — Stax design (sidebar + topbar + bottom ticker). Wraps every
 * route under (app). Pages render only their inner content; the shell
 * self-fetches BTC + 5-asset tickers from Bitget public REST so it works
 * regardless of which page is open.
 *
 * Forced dynamic — without this, Next prerenders static HTML at build time
 * which means usePathname() in StaxSidebar returns null and the active nav
 * item defaults to Dashboard regardless of the actual route. Dynamic
 * rendering gives every request the real URL so the highlight is correct
 * before the client even hydrates.
 */
export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <StaxAppShell>{children}</StaxAppShell>
    </ThemeProvider>
  )
}
