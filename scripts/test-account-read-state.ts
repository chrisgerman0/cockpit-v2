/**
 * Proof for lib/account-read-state.ts — the gate that decides whether the dashboard is allowed
 * to show the STRATEGY's record in place of the USER's.
 *
 * Run:  npx tsc --outDir /tmp/staxs-read-state-test --module commonjs --target es2020 \
 *            lib/account-read-state.ts scripts/test-account-read-state.ts
 *       node /tmp/staxs-read-state-test/scripts/test-account-read-state.js
 *
 * Case 1 is the 2026-10-06 incident reproduced exactly: HTTP 431 on all three authed reads.
 * It is the regression this file exists to hold.
 */
import { deriveReadState, type ReadInputs } from '../lib/account-read-state'

type Case = { name: string; input: ReadInputs; expect: { isPreviewState: boolean; accountReadFailed: boolean; noBot: boolean } }

// A 431/500/abort produces NO parsed body, so botRes is null and the trades fetch never resolved.
const FAILED_READ: ReadInputs = {
  botRes: null,
  balanceRes: { error: '431 Request Header Fields Too Large: /api/balance' },
  tradesAnswered: false,
  sawUnauthenticated: false,
  sawUpstreamDown: false,
  sawReadFailure: true,
}

const cases: Case[] = [
  {
    name: '431 on all three reads (Chris, 2026-10-06 10:25) — never the backtest preview',
    input: FAILED_READ,
    expect: { isPreviewState: false, accountReadFailed: true, noBot: false },
  },
  {
    name: 'a 500 that nothing classified — same rule, no preview',
    input: { ...FAILED_READ, balanceRes: { error: '500 Internal Server Error: /api/balance' } },
    expect: { isPreviewState: false, accountReadFailed: true, noBot: false },
  },
  {
    name: 'upstream 503 — not a statement about the user either',
    input: { ...FAILED_READ, sawReadFailure: false, sawUpstreamDown: true },
    expect: { isPreviewState: false, accountReadFailed: true, noBot: false },
  },
  {
    name: 'genuinely new user: routes answered, nothing configured — preview STILL works',
    input: {
      botRes: { activated: false },
      balanceRes: { error: 'no api keys on file' },
      tradesAnswered: true,
      sawUnauthenticated: false, sawUpstreamDown: false, sawReadFailure: false,
    },
    expect: { isPreviewState: true, accountReadFailed: false, noBot: true },
  },
  {
    name: 'live activated account, flat book — own (empty) record, no strategy substitution',
    input: {
      botRes: { activated: true, config: { tier: 'aggressive' } },
      balanceRes: { equity: 8313.98 },
      tradesAnswered: true,
      sawUnauthenticated: false, sawUpstreamDown: false, sawReadFailure: false,
    },
    expect: { isPreviewState: false, accountReadFailed: false, noBot: false },
  },
  {
    name: 'bot read OK but the TRADE read failed — still no phantom positions',
    input: {
      botRes: { activated: false },
      balanceRes: { equity: 8313.98 },
      tradesAnswered: false,
      sawUnauthenticated: false, sawUpstreamDown: false, sawReadFailure: true,
    },
    expect: { isPreviewState: false, accountReadFailed: true, noBot: true },
  },
]

let failed = 0
for (const c of cases) {
  const got = deriveReadState(c.input)
  const bad = (Object.keys(c.expect) as Array<keyof typeof c.expect>)
    .filter(k => got[k] !== c.expect[k])
  if (bad.length) {
    failed++
    console.log(`FAIL  ${c.name}`)
    for (const k of bad) console.log(`        ${k}: expected ${c.expect[k]}, got ${got[k]}`)
  } else {
    console.log(`PASS  ${c.name}`)
  }
}
console.log(failed === 0 ? `\nPASS ${cases.length}/${cases.length}` : `\nFAIL ${failed}/${cases.length} failing`)
process.exit(failed === 0 ? 0 : 1)
