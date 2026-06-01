/**
 * Dashboard-side mirror of /staxs-landing/lib/phase-h-basket.ts.
 *
 * Both halves of the app (staxs-landing API + this dashboard) need the same
 * basket list, but they're separate npm packages — sharing via import would
 * couple the build. Source-level duplication is fine because the basket is
 * a strategy constant updated infrequently. If you change one, change both.
 *
 * 2026-05-24 (P5 fix): expanded from V1 7-asset list to the 14-asset Phase H
 * super-stack. Order matches phase_i_dashboard_json_gen.py ASSETS_14.
 * 2026-06-01: added NEAR + OP for the assembled 71-cfg B+D system (16 assets).
 *   Order matches the publisher's ASSETS = ASSETS_14 + ['NEAR','OP'].
 */

export const PHASE_H_BASKET = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'LINK',
  'SUI', 'AVAX', 'ADA', 'TRX', 'ZEC', 'TON', 'HYPE',
  'NEAR', 'OP',
] as const

export type PhaseHAsset = typeof PHASE_H_BASKET[number]

export const PHASE_H_SYMBOLS = PHASE_H_BASKET.map(a => `${a}USDT` as const)
export type PhaseHSymbol = typeof PHASE_H_SYMBOLS[number]

// Logo URLs per asset. CDN-hosted SVGs first, local fallback for assets the
// CDN doesn't carry. If a new asset is added to the basket, add the logo
// here too — the UI silently shows just the symbol abbreviation if missing.
export const ASSET_LOGOS: Record<PhaseHSymbol, string> = {
  BTCUSDT:  'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
  ETHUSDT:  'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg',
  SOLUSDT:  '/coin-icons/sol.png',
  BNBUSDT:  'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/bnb.svg',
  XRPUSDT:  'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/xrp.svg',
  DOGEUSDT: '/coin-icons/doge.svg',
  LINKUSDT: '/coin-icons/link.svg',
  SUIUSDT:  '/coin-icons/sui.png',
  AVAXUSDT: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/avax.svg',
  ADAUSDT:  'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/ada.svg',
  TRXUSDT:  'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/trx.svg',
  ZECUSDT:  'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/zec.svg',
  TONUSDT:  '/coin-icons/ton.png',
  HYPEUSDT: '/coin-icons/hype.png',
  NEARUSDT: '/coin-icons/near.png',
  OPUSDT:   '/coin-icons/op.png',
}

export type CoinFilter = 'ALL' | PhaseHAsset

export const COIN_FILTERS: CoinFilter[] = ['ALL', ...PHASE_H_BASKET]
