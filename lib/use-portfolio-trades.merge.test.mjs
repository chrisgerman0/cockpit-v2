/**
 * Merge open-reconciliation test — mergePublisherAndShadow opens block.
 * Run: node lib/use-portfolio-trades.merge.test.mjs
 *
 * Mirrors the EXACT opens-merge logic from use-portfolio-trades.tsx (the .tsx
 * imports React hooks so can't be required directly in node). Keep this in lock
 * step with the source opens block. Proves the 2026-06-03 union-by-asset
 * hardening: shadow lag can never HIDE a backtest open, the lane cap is
 * respected, and assets both engines hold are not double-counted.
 */
function mergeOpens(pubOpens, shdOpens, viewedTier) {
  const TIER_LANES = { conservative: 2, moderate: 3, aggressive: 5 }
  const laneCap = viewedTier ? (TIER_LANES[viewedTier] ?? Infinity) : Infinity
  const shdOpenBySymbol = new Map()
  for (const t of shdOpens) shdOpenBySymbol.set(t.symbol, t)
  const opens = pubOpens.map(t => shdOpenBySymbol.get(t.symbol) ?? t)
  const pubOpenSymbols = new Set(pubOpens.map(t => t.symbol))
  const shadowOnlyOpens = shdOpens.filter(t => !pubOpenSymbols.has(t.symbol))
    .sort((a, b) => (b.entryTs || 0) - (a.entryTs || 0))
  for (const t of shadowOnlyOpens) { if (opens.length >= laneCap) break; opens.push(t) }
  return opens
}

const P = (s, src = 'pub', ts = 1) => ({ symbol: s, src, entryTs: ts })
const syms = o => o.map(t => `${t.symbol}:${t.src}`).join(', ')
let pass = 0, fail = 0
function check(name, got, want) {
  const ok = got.map(t => t.symbol).sort().join(',') === want.sort().join(',')
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}: [${syms(got)}]`)
  ok ? pass++ : fail++
}

// 1. Steady-state / current real divergence: shadow has 0 opens → publisher preserved.
check('shadow 0 opens → all publisher opens kept',
  mergeOpens([P('OPUSDT'), P('AVAXUSDT'), P('DOGEUSDT')], [], 'aggressive'),
  ['OPUSDT', 'AVAXUSDT', 'DOGEUSDT'])

// 2. THE HIDE-BUG (the 2026-06-02 disable cause): shadow holds OP only while the
//    backtest holds OP/AVAX/DOGE. AVAX+DOGE must NOT vanish; OP uses shadow's row.
const r2 = mergeOpens([P('OPUSDT'), P('AVAXUSDT'), P('DOGEUSDT')], [P('OPUSDT', 'shd')], 'aggressive')
check('hide-bug fixed: AVAX/DOGE survive shadow-OP-only', r2, ['OPUSDT', 'AVAXUSDT', 'DOGEUSDT'])
if (r2.find(t => t.symbol === 'OPUSDT')?.src !== 'shd') { console.log('    FAIL: OP should use shadow row'); fail++ }

// 3. Lane cap (moderate=3): pub SOL/AVAX/TRX (3 = cap), shadow TRX/ADA. ADA can't fit.
const r3 = mergeOpens([P('SOLUSDT'), P('AVAXUSDT'), P('TRXUSDT')], [P('TRXUSDT', 'shd'), P('ADAUSDT', 'shd', 9)], 'moderate')
check('cap respected: shadow-only ADA dropped at moderate 3', r3, ['SOLUSDT', 'AVAXUSDT', 'TRXUSDT'])

// 4. Shadow-only bridge ADDED when under cap (aggressive=5).
check('shadow-only bridge added under cap',
  mergeOpens([P('OPUSDT'), P('AVAXUSDT'), P('DOGEUSDT')], [P('TONUSDT', 'shd')], 'aggressive'),
  ['OPUSDT', 'AVAXUSDT', 'DOGEUSDT', 'TONUSDT'])

// 5. No double-count when both hold the same assets.
check('no double-count when both hold OP+AVAX',
  mergeOpens([P('OPUSDT'), P('AVAXUSDT')], [P('OPUSDT', 'shd'), P('AVAXUSDT', 'shd')], 'aggressive'),
  ['OPUSDT', 'AVAXUSDT'])

console.log(`\n  ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass}/${pass + fail})`)
process.exit(fail === 0 ? 0 : 1)
