/**
 * LEVERAGE CEILING — config-time safety guard for the bot settings wizard.
 * 2026-06-02.
 *
 * The custom grid is {2,3,4,5} lanes × {25,50,75,100%} sizing. A combo's
 * worst-case NOMINAL leverage = n_lanes × base_pct (reached when per-lane
 * notional is below the $25k cap, i.e. capital ≲ $25k/base_pct; above that the
 * cap REDUCES leverage, so this is the conservative worst case).
 *
 * The ceiling rejects a combo when EITHER:
 *   (1) nominal leverage exceeds MAX_SAFE_NOMINAL_LEVERAGE (5×) — beyond the
 *       proven-safe envelope. The deployed Aggressive 5-lane / 100% config sits
 *       exactly at 5× nominal and was stress-validated against Black Monday in
 *       msga-replay/.../phase_c_runs/sizing_stress.py: real peak leverage 2.9×
 *       (sub-linear k=0.75 sizing damps it), worst-case margin 80.7% remaining,
 *       0 liquidation events. 5× nominal is the proven ceiling; above it is
 *       unvalidated and blocked.
 *   (2) nominal leverage exceeds the user's Bitget account leverage cap — the
 *       account physically cannot margin the exposure (generalizes the existing
 *       activation floor check to a per-config ceiling).
 *
 * Pure + dependency-free so it runs identically in the wizard UI (grey out
 * unsafe cells) and server-side in /api/bot-activate (enforce). Proven:
 * test_leverage_ceiling.mjs.
 */

export const MAX_SAFE_NOMINAL_LEVERAGE = 5      // deployed Aggressive 5L/100%, 0-liq proven
export const PER_LANE_CAP_USD = 25000
export const MMR = 0.005                         // Bitget USDT-perp maintenance margin rate

export type CeilingReason =
  | 'ok'
  | 'exceeds_max_leverage'        // > 5× nominal — beyond the proven envelope
  | 'account_leverage_insufficient' // account cap can't margin the exposure
  | 'invalid_input'

export interface CeilingInput {
  nLanes: number          // 2..5 (or custom)
  basePct: number         // 0.25 | 0.5 | 0.75 | 1.0  (fraction of capital per lane)
  capitalUsd: number      // user's starting capital
  accountLeverage?: number // Bitget account leverage cap (×). Omitted/0 → skip the account check.
}

export interface CeilingResult {
  safe: boolean
  reason: CeilingReason
  nominalLeverage: number     // n_lanes × base_pct (worst case)
  perLaneNotionalUsd: number  // base_pct × capital, capped at $25k
  netExposureUsd: number      // n_lanes × per-lane
  maintenanceMarginUsd: number
  message: string
}

/** Per-lane notional at equity == capital (the sizing baseline), with the $25k cap. */
export function perLaneNotionalUsd(basePct: number, capitalUsd: number): number {
  return Math.min(basePct * capitalUsd, PER_LANE_CAP_USD)
}

/** Evaluate a single (lanes × sizing) combo against the leverage ceiling. */
export function evaluateLeverageCeiling(input: CeilingInput): CeilingResult {
  const { nLanes, basePct, capitalUsd, accountLeverage = 0 } = input
  const fail = (reason: CeilingReason, message: string): CeilingResult => ({
    safe: false, reason, message, nominalLeverage: NaN, perLaneNotionalUsd: NaN,
    netExposureUsd: NaN, maintenanceMarginUsd: NaN,
  })

  if (!Number.isFinite(nLanes) || nLanes < 1 || !Number.isFinite(basePct) || basePct <= 0 ||
      !Number.isFinite(capitalUsd) || capitalUsd <= 0) {
    return fail('invalid_input', 'Invalid lanes / sizing / capital.')
  }

  // Worst-case nominal leverage = lanes × sizing% (per-lane below the $25k cap).
  const nominalLeverage = nLanes * basePct
  const perLane = perLaneNotionalUsd(basePct, capitalUsd)
  const netExposure = nLanes * perLane
  const maint = netExposure * MMR

  const base: Omit<CeilingResult, 'safe' | 'reason' | 'message'> = {
    nominalLeverage,
    perLaneNotionalUsd: perLane,
    netExposureUsd: netExposure,
    maintenanceMarginUsd: maint,
  }

  if (nominalLeverage > MAX_SAFE_NOMINAL_LEVERAGE + 1e-9) {
    return {
      ...base, safe: false, reason: 'exceeds_max_leverage',
      message: `${nLanes} lanes × ${Math.round(basePct * 100)}% = ${nominalLeverage.toFixed(2)}× leverage exceeds the ` +
        `${MAX_SAFE_NOMINAL_LEVERAGE}× safe ceiling (the stress-validated Aggressive max). Reduce lanes or sizing.`,
    }
  }
  if (accountLeverage > 0 && nominalLeverage > accountLeverage + 1e-9) {
    return {
      ...base, safe: false, reason: 'account_leverage_insufficient',
      message: `This config needs ${nominalLeverage.toFixed(2)}× but your Bitget account leverage cap is ${accountLeverage}×. ` +
        `Raise your account leverage to ≥ ${Math.ceil(nominalLeverage)}× or reduce lanes/sizing.`,
    }
  }
  return { ...base, safe: true, reason: 'ok', message: `Safe — ${nominalLeverage.toFixed(2)}× nominal leverage.` }
}

/** Build the full {2,3,4,5} × {25,50,75,100%} grid with per-cell safe/unsafe verdicts. */
export function buildCeilingGrid(capitalUsd: number, accountLeverage = 0) {
  const laneOpts = [2, 3, 4, 5]
  const pctOpts = [0.25, 0.5, 0.75, 1.0]
  return laneOpts.map((nLanes) => ({
    nLanes,
    cells: pctOpts.map((basePct) => ({
      basePct,
      ...evaluateLeverageCeiling({ nLanes, basePct, capitalUsd, accountLeverage }),
    })),
  }))
}
