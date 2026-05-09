import type { Metadata } from 'next'
import { Geist, JetBrains_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const jetBrainsMono = JetBrains_Mono({ variable: '--font-jetbrains-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Staxs · Cockpit',
  description: 'Staxs trading cockpit — next-gen dashboard',
}

/**
 * Pre-paint fallback for first-time visitors who have a localStorage
 * theme but no cookie yet (because the cookie write only happens after
 * the user lands on a page in this build for the first time).
 *
 * The PRIMARY mechanism is the cookie read below — that bakes the right
 * html class into the SSR response so the browser never paints with the
 * wrong theme. This script only runs when the cookie is absent.
 */
const themeBootstrap = `
(function () {
  try {
    if (document.documentElement.classList.contains('light') || document.documentElement.classList.contains('dark')) return;
    var t = localStorage.getItem('stax-theme');
    if (t !== 'light' && t !== 'dark') {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    document.documentElement.classList.add(t);
    // Persist for the next request so SSR has it.
    try { document.cookie = 'stax-theme=' + t + '; path=/; max-age=' + (60 * 60 * 24 * 365) + '; SameSite=Lax'; } catch (e) {}
  } catch (e) {}
})();
`.trim()

/**
 * Root layout. App chrome lives in app/(app)/layout.tsx so auth routes can
 * opt out later.
 *
 * Theme handling (FOUC-free):
 *   1. StaxTopBar's toggle writes `stax-theme` to BOTH localStorage and a
 *      cookie of the same name (`SameSite=Lax`, 1y).
 *   2. This Server Component reads the cookie via `next/headers` and
 *      adds `light` / `dark` to <html>'s className before the response
 *      is even sent — so the very first paint is correct, no flash.
 *   3. The fallback script in <head> only fires when the cookie is
 *      absent (first visit ever on this build), in which case it pulls
 *      from localStorage or `prefers-color-scheme` and writes the cookie
 *      so subsequent loads are SSR-correct.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieJar = await cookies()
  const stored = cookieJar.get('stax-theme')?.value
  const themeClass = stored === 'light' || stored === 'dark' ? stored : ''
  const htmlClass = `${geistSans.variable} ${jetBrainsMono.variable}${themeClass ? ` ${themeClass}` : ''}`
  return (
    <html lang="en" suppressHydrationWarning className={htmlClass}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}
