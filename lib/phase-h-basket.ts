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
 * 2026-07-04: added SEI + ONDO → 18-asset basket (KAMIKAZE-tier expansion).
 * 2026-07-05: added HBAR → 19-asset Phase I basket.
 */

// 2026-09-03: this is the FOURTH hand-maintained copy of the basket found today, and like the
// others it had drifted — 19 assets against a 29-asset basket, still listing HYPE (no longer
// traded) and missing eleven coins that are. It drives the Live Trading pair chips, the coin
// icons and the symbol filters, so a traded coin missing from here shows a customer the wrong
// logo and cannot be filtered for. Generated from the basket the engine actually trades.
import { PHASE_H_BASKET_GENERATED } from './phase-h-basket.generated'

const PHASE_H_BASKET_FALLBACK = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'LINK',
  'SUI', 'AVAX', 'ADA', 'TRX', 'ZEC', 'GRAM',
  'NEAR', 'OP', 'SEI', 'ONDO', 'HBAR',
] as const

export const PHASE_H_BASKET: readonly string[] =
  (PHASE_H_BASKET_GENERATED && PHASE_H_BASKET_GENERATED.length)
    ? PHASE_H_BASKET_GENERATED
    : PHASE_H_BASKET_FALLBACK

export type PhaseHAsset = string

export const PHASE_H_SYMBOLS: readonly string[] = PHASE_H_BASKET.map(a => `${a}USDT`)
export type PhaseHSymbol = string

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
  GRAMUSDT: '/coin-icons/ton.png',  // 2026-06-17: GRAM = rebranded TON; reuse the TON logo
  HYPEUSDT: '/coin-icons/hype.png',
  NEARUSDT: '/coin-icons/near.png',
  OPUSDT:   '/coin-icons/op.png',
  SEIUSDT:  '/coin-icons/sei.png',
  ONDOUSDT: '/coin-icons/ondo.png',
  HBARUSDT: '/coin-icons/hbar.svg',   // 2026-07-05: drop hbar.png into public/coin-icons/ (UI shows symbol-only until then)
}

export type CoinFilter = 'ALL' | PhaseHAsset

export const COIN_FILTERS: CoinFilter[] = ['ALL', ...PHASE_H_BASKET]

// ─── Legacy / rebrand label normalization ───────────────────────────────────
// GRAM is the 1:1 rebrand of TON (Option B, 2026-06-17). cfg_sids keep the
// V3G_TON_* prefix, and pre-remap backtest/event data still carries the 'TON'
// label. Route every DISPLAY label through here so all surfaces show the asset's
// CURRENT identity (chips, filters, icons). Future renames = 1 line.
const ASSET_ALIASES: Record<string, string> = { TON: 'GRAM' }

/** Normalize a raw asset/symbol token to its canonical current asset (no USDT). */
export function canonicalAsset(raw: string | null | undefined): string {
  if (!raw) return ''
  const a = raw.replace(/USDT$/i, '').toUpperCase()
  return ASSET_ALIASES[a] ?? a
}

/** Normalize a raw asset/symbol token to its canonical USDT symbol. */
export function canonicalSymbol(raw: string | null | undefined): string {
  const a = canonicalAsset(raw)
  return a ? `${a}USDT` : ''
}
