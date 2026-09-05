/**
 * ONE icon resolver for every asset, used by every page.
 *
 * Chris, 2026-09-05: "they are missing on all pages. Make sure it is propagated to all sections
 * where an icon is used. Dashboard, Live Trading, Backtesting pages."
 *
 * WHY THEY KEPT GOING MISSING. There were FOUR separate icon maps — StaxDashboard, AdminPage
 * (five entries), lib/phase-h-basket.ts and BacktestingPage (nineteen) — so every new asset had to
 * be added in four places and was invariably added in one or two. AdminPage rendered an icon for
 * exactly BTC/ETH/XRP/SOL/SUI and nothing else. That is the same duplicate-implementation problem
 * Chris ruled on for the money maths (§CLONE-THE-ENGINE, VA3), one layer up: same inputs, four
 * copies, three of them stale.
 *
 * Every one of the 29 basket assets is now vendored under /coin-icons, so nothing depends on a CDN
 * at render time. Unknown symbols fall back to the same CDN the app already trusted, and if THAT
 * fails the caller renders nothing rather than a broken-image box.
 */

// GRAM trades on TON's market — one coin, two names (bible §GRAM-AND-TON-ARE-ONE-COIN).
const ALIAS: Record<string, string> = { GRAM: 'ton', TON: 'ton' }

/** Local files present under public/coin-icons, by lowercase symbol. */
// 2026-09-05: TAO, PEPE, RUNE, WLD and HBAR moved svg -> png. The five SVGs they replaced were
// PLACEHOLDERS, not logos — a coloured circle with the ticker typed inside it (`<circle>` + a
// `<text>` element, ~390 bytes each) — and HBAR was hand-drawn rectangles approximating the
// Hedera H. Chris spotted it: "Whatever you have used is not the official logo." The real marks
// are now vendored from the projects' own artwork, masked to a circle so a square JPEG corner
// never shows as a box on either theme. The originals are kept under
// public/coin-icons/_retired_placeholders/ rather than deleted.
const LOCAL: Record<string, string> = {
  aave: 'svg', ada: 'png', atom: 'svg', avax: 'png', bch: 'svg', bnb: 'svg', btc: 'svg',
  doge: 'svg', etc: 'svg', eth: 'svg', fil: 'svg', hbar: 'png', hype: 'png', link: 'svg',
  ltc: 'svg', near: 'png', ondo: 'png', op: 'png', pepe: 'png', rune: 'png', sei: 'png',
  sol: 'png', sui: 'png', tao: 'png', ton: 'png', trx: 'png', wld: 'png', xlm: 'svg',
  xrp: 'svg', zec: 'png',
}

/** Strip a trading-pair suffix: BTCUSDT -> BTC, BTC/USDT -> BTC. */
export function baseSymbol(sym: string): string {
  if (!sym) return ''
  return sym.toUpperCase().replace(/[-/_]?(USDT|USDC|PERP|USD)$/, '')
}

/**
 * Icon URL for a symbol or trading pair, or null when there is nothing sensible to show.
 * Accepts 'BTC', 'BTCUSDT', 'btc/usdt' alike.
 */
export function coinIconUrl(sym: string): string | null {
  const base = baseSymbol(sym)
  if (!base) return null
  const key = ALIAS[base] ?? base.toLowerCase()
  const ext = LOCAL[key]
  if (ext) return `/coin-icons/${key}.${ext}`
  // Unknown asset: the CDN this app already used. Better a late icon than a blank cell.
  return `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${key}.svg`
}
