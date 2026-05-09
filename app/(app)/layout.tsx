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
 *
 * Theme: handled by the inline pre-paint script in app/layout.tsx (which
 * reads `stax-theme` localStorage — same key StaxTopBar's toggle writes).
 * The previous next-themes <ThemeProvider> wrapper was removed because it
 * used a DIFFERENT storage key (`staxs-theme`) that was never written, so
 * it forced dark on every navigation regardless of the user's choice.
 */
export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <StaxAppShell>{children}</StaxAppShell>
}
