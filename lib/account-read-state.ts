/**
 * WHAT THIS FILE IS FOR
 * ─────────────────────
 * The dashboard has exactly three things it can know about an account on any given load:
 *
 *   1. the account ANSWERED and is configured      → show the account
 *   2. the account ANSWERED and is not set up yet  → show the strategy preview
 *   3. the account DID NOT ANSWER                  → show neither, and say so
 *
 * State 3 kept collapsing into state 2. `noBot` was written as
 * `!botRes?.activated || !botRes?.config`, and optional chaining on a null response yields
 * `undefined` just as a genuine "activated: false" does — so a failed read and a brand-new user
 * produced the same boolean, and the preview fallbacks fired over live accounts.
 *
 * 2026-10-06, the incident that forced this out into its own file: Chris's iPhone received
 * HTTP 431 (Request Header Fields Too Large — nginx permits 64k of headers, the Node origin
 * capped at 16k) on /api/bot-activate, /api/balance and /api/trades-live at 10:24:44, 10:25:12
 * and 10:25:43. The dashboard's error classifier recognised only 401 and 503, so nothing marked
 * the reads as failed, and his funded, trading account was served the new-user preview: the
 * strategy's illustrative $10k→$20k backtest curve, the strategy's closed trades in Recent
 * Trades, phantom strategy positions summing to −$195.56, and "Bot Status: Off".
 *
 * These predicates are pure and exported so they can be proved in isolation
 * (scripts/test-account-read-state.ts) rather than only through a browser.
 */

export type ReadInputs = {
  /** /api/bot-activate — `null` means the request did not come back with an answer. */
  botRes: { activated?: boolean; config?: unknown } | null
  /** /api/balance — an `error` field means it answered with a refusal, not a balance. */
  balanceRes: { equity?: number; error?: string } | null
  /** Did /api/trades-live resolve on THIS pass? A cached or empty fallback is not an answer. */
  tradesAnswered: boolean
  /** The server rejected us (401 after refresh). */
  sawUnauthenticated: boolean
  /** A dependency reported itself unavailable (503 / auth unreachable). */
  sawUpstreamDown: boolean
  /** Anything else that stopped us finding out: 431, 4xx, 5xx, abort, network error. */
  sawReadFailure: boolean
}

export type ReadState = {
  /** /api/bot-activate came back with a body. */
  botAnswered: boolean
  /** It answered, AND said this user has no active configuration. A real fact about the user. */
  noBot: boolean
  /** It did not answer. Not a fact about the user — a fact about this request. */
  botUnknown: boolean
  /** The balance route answered with a usable figure. */
  balanceOk: boolean
  /** It answered, and the answer was "this user has connected no API keys". */
  noKeys: boolean
  /** At least one account read did not answer. Gates every strategy-for-user substitution. */
  accountReadFailed: boolean
  /**
   * Safe to render the strategy preview (backtest curve, strategy trades, strategy positions).
   * Requires that we ESTABLISHED there is nothing of the user's to show.
   */
  isPreviewState: boolean
}

export function deriveReadState(i: ReadInputs): ReadState {
  const botAnswered = i.botRes !== null
  const botUnknown = !botAnswered
  const noBot = botAnswered && (!i.botRes?.activated || !i.botRes?.config)

  const balanceAnswered = i.balanceRes !== null
  const balanceOk = balanceAnswered && !i.balanceRes?.error
  const noKeys = balanceAnswered && /no api keys/i.test(i.balanceRes?.error || '')

  // A rejection (401) is handled upstream of this by routing to the sign-in state, so it is not
  // folded in here. Everything else that prevented an answer is.
  const accountReadFailed = botUnknown || !i.tradesAnswered || i.sawReadFailure || i.sawUpstreamDown

  const isPreviewState = (noKeys || noBot) && !botUnknown && i.tradesAnswered && !i.sawReadFailure

  return { botAnswered, noBot, botUnknown, balanceOk, noKeys, accountReadFailed, isPreviewState }
}
