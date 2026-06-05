/**
 * Cfg-aware progress bar logic for Live Trading open positions.
 *
 * Replaces the hardcoded "1.5% trail activation + 4% SL" assumption from
 * the legacy SLDangerCell. Each cfg in the Phase H basket has its own SL
 * placement (varies 2-5% + dynamic via swing_low / donchian_20 / atr_2),
 * its own trail mode (off / multi_tier / chandelier / atr_2 / fixed_3pct),
 * its own breakeven trigger (off / 0.5R / 1R / 2R), and a strong-alert gate
 * that may or may not have passed.
 *
 * This module takes the cfg dims + current position state + live mark price
 * and returns a ProgressPhase describing what to render. See
 * docs/PROGRESS_BAR_CFG_AWARE_DESIGN.md for the audit + design rationale.
 *
 * STRATEGY IP: the dim NAMES (multi_tier, mfe_gt_2pct, etc.) are admin-only.
 * The labels returned by this module are already translated to neutral
 * customer-facing vocabulary ("Trailing TP active", "Breakeven moved",
 * "Strong-alert armed").
 */

import type { CfgDims } from '@/lib/use-live-trading-data'

export type ProgressPhase = 'red' | 'yellow' | 'green' | 'idle'

export type ProgressBarState = {
  phase: ProgressPhase
  /** 0-100, where the fill bar lands. Phase-dependent semantics. */
  fillPct: number
  /** Primary label rendered under the bar. Mechanical + precise (Chris Q1). */
  label: string
  /** Secondary label, e.g. "tier 2 · 50% retrace" for multi_tier. May be empty. */
  sublabel: string
  /** When true, the bar pulses (cell-level CSS animation). */
  flash: boolean
  /** Badges to render alongside the bar — strong-alert armed, BE moved, etc. */
  badges: ProgressBadge[]
}

export type ProgressBadge = {
  kind: 'strong_alert_armed' | 'be_moved'
  label: string
  /** When true, the badge has a gold pulse (Chris Q3 — gold for "armed" state). */
  pulse: boolean
}

/** Direction-aware "is price favorable vs entry?" check. */
function isFavorable(side: 'LONG' | 'SHORT', entryPx: number, currentPx: number): boolean {
  return side === 'LONG' ? currentPx > entryPx : currentPx < entryPx
}

/** Compute the multi_tier trail activation tier from MFE %.
 *  Returns tier 0 (not active) or 1-4 (active at increasing tightness).
 *  Tier 1: MFE ≥ 1.5%, 60% retrace allowed
 *  Tier 2: MFE ≥ 3%, 50% retrace
 *  Tier 3: MFE ≥ 5%, 40% retrace
 *  Tier 4: MFE ≥ 8%, 30% retrace
 *  Mirrors engine.py:_compute_trail_price multi_tier branch. */
export function multiTierLevel(mfePct: number): { tier: 0 | 1 | 2 | 3 | 4; retracePct: number } {
  if (mfePct >= 8) return { tier: 4, retracePct: 30 }
  if (mfePct >= 5) return { tier: 3, retracePct: 40 }
  if (mfePct >= 3) return { tier: 2, retracePct: 50 }
  if (mfePct >= 1.5) return { tier: 1, retracePct: 60 }
  return { tier: 0, retracePct: 0 }
}

/** Trail activation threshold (MFE % needed to ARM the trail).
 *  Pre-activation, no trail line is drawn — bar shows progress toward arming. */
function trailActivationPct(trailMode: string): number {
  switch (trailMode) {
    case 'multi_tier':  return 1.5     // first tier
    case 'chandelier':  return 0       // chandelier is ATR-based, fires from bar 1
    case 'atr_2':       return 0       // ATR-based, fires from bar 1
    case 'fixed_3pct':  return 3.0     // needs MFE > trail distance to net positive
    case 'off':         return Infinity
    default:            return Infinity
  }
}

/** Strong-alert gate threshold (MFE % needed to pass the gate). */
function strongAlertGateMfeThreshold(gate: string): number {
  switch (gate) {
    case 'mfe_gt_2pct':    return 2.0
    case 'mfe_gt_4pct':    return 4.0
    case 'mfe_and_time':   return 2.0   // (also needs bars_held > 6 — checked separately)
    case 'time_gt_6bars':  return 0     // time-only gate; no MFE threshold
    case 'baseline':       return 0     // always passes
    case 'off':            return Infinity
    default:               return Infinity
  }
}

/** Strong-alert gate label for customer display. Translates IP-loaded gate
 *  name to neutral vocabulary. Per Chris (2026-05-27): customer-facing label
 *  is "Take-profit armed" — generalizes the badge to "an extra TP signal is
 *  available beyond the standard RSI path" without exposing the specific
 *  strong-alert mechanic. The yellow-phase label still says "to Strong-alert
 *  TP" because that's the precise condition the gate is waiting on. */
function strongAlertLabel(_gate: string): string {
  return 'Take-profit armed'
}

/** Translate trail_mode to customer-facing label. */
function trailModeLabel(trailMode: string): string {
  switch (trailMode) {
    case 'multi_tier':  return 'Trailing TP'
    case 'chandelier':  return 'ATR Trail'
    case 'atr_2':       return 'ATR Trail'
    case 'fixed_3pct':  return 'Fixed Trail'
    case 'off':         return ''
    default:            return 'Trail'
  }
}

/**
 * Main entry — compute the ProgressBarState for a position given its cfg dims,
 * current entry/SL/MFE state, and live mark price.
 *
 * Universal RED phase: distance from current mark to hard SL. Shrinks as
 * price moves against position. Flash when within 0.5%.
 *
 * YELLOW phase: between break-even and the cfg's "armed" threshold (trail
 * activation for archetypes A/B, gate MFE threshold for C/D).
 *
 * GREEN phase: trail active (A/B) or armed/exit-conditions-near (C/D).
 *
 * Returns null if essential data missing (no entry / no mark / no cfg).
 */
export function computeProgressBarState(args: {
  cfg: CfgDims
  side: 'LONG' | 'SHORT'
  entryPx: number
  slPx: number | null
  mfePct: number | null
  beMovedFromState: boolean
  currentPx: number
}): ProgressBarState | null {
  const { cfg, side, entryPx, slPx, mfePct, beMovedFromState, currentPx } = args
  if (!Number.isFinite(entryPx) || entryPx <= 0) return null
  if (!Number.isFinite(currentPx) || currentPx <= 0) return null
  if (slPx == null || !Number.isFinite(slPx) || slPx <= 0) return null

  // Direction-aware unrealized PnL%. Positive = favorable.
  const pnlPct = side === 'LONG'
    ? ((currentPx - entryPx) / entryPx) * 100
    : ((entryPx - currentPx) / entryPx) * 100

  // Distance from current price to SL, in pct of current price.
  // Positive cushion = still safe; negative = past SL (should have closed).
  const cushionToSl = side === 'LONG'
    ? ((currentPx - slPx) / currentPx) * 100
    : ((slPx - currentPx) / currentPx) * 100

  // Initial SL cushion (entry → SL distance, the "100% cushion" reference).
  const initialCushionPct = side === 'LONG'
    ? ((entryPx - slPx) / entryPx) * 100
    : ((slPx - entryPx) / entryPx) * 100

  const archetype = cfg.archetype
  const badges: ProgressBadge[] = []

  // ─── Strong-alert badge ───────────────────────────────────────────────────
  // The "strong-alert TP" is a separate exit signal gated by MFE/time. When
  // the gate passes, the TP can fire on the next bar-close strong-alert
  // pattern. UI surfaces this as a "Strong-alert armed" badge — but ONLY
  // for cfgs whose gate is genuinely conditional. Baseline = "always armed"
  // = default state; showing the badge would give the customer no signal
  // since it'd just always be on. Off = TP disabled, never armed.
  //
  // Genuinely-gated values: mfe_gt_2pct, mfe_gt_4pct, mfe_and_time, time_gt_6bars.
  // (2026-05-27 fix: previously the badge surfaced for `baseline` too,
  // creating false-positive "armed" labels on TRX SHORT and other baseline cfgs.)
  const isGenuinelyGated = (
    cfg.strong_alert_gate === 'mfe_gt_2pct' ||
    cfg.strong_alert_gate === 'mfe_gt_4pct' ||
    cfg.strong_alert_gate === 'mfe_and_time' ||
    cfg.strong_alert_gate === 'time_gt_6bars'
  )
  if (isGenuinelyGated) {
    const gateMfe = strongAlertGateMfeThreshold(cfg.strong_alert_gate)
    // 2026-05-27: gate-passed check uses live-peak MFE (engine mfe_abs may
    // lag intra-bar). max(engine, current_pnl_if_favorable).
    const livePeakMfe = Math.max(mfePct ?? 0, Math.max(0, pnlPct))
    const gatePassed = livePeakMfe >= gateMfe
    if (gatePassed) {
      badges.push({
        kind: 'strong_alert_armed',
        label: strongAlertLabel(cfg.strong_alert_gate),
        pulse: true,
      })
    }
  }

  // ─── Breakeven moved badge (cross-cutting for archetypes B + C) ──────────
  if (beMovedFromState) {
    badges.push({
      kind: 'be_moved',
      label: 'Breakeven moved',
      pulse: false,
    })
  }

  // ─── RED phase — universal — distance to hard SL ─────────────────────────
  // Phase activates when price is moving toward SL (not yet favorable, or
  // pulled back from MFE). The bar fills from 0 (just past entry toward SL)
  // to 100 (at SL).
  // 2026-06-05 fix (Chris): a fresh position in PROFIT but with mfePct still 0
  // (engine writes mfe_abs only at bar close — the SAME lag corrected at line 265)
  // was wrongly forced into RED "to Stop Loss". Lag-correct the MFE here too so a
  // winning-but-pre-arm position (e.g. LINK +0.51%, mfePct=0) shows YELLOW tracking
  // the trail-arm, not red tracking the stop. RED stays for genuine loss / flat-no-MFE.
  const effMfe = Math.max(mfePct ?? 0, Math.max(0, pnlPct))
  if (pnlPct < 0 || effMfe === 0) {
    const fill = initialCushionPct > 0
      ? Math.max(0, Math.min(100, (1 - cushionToSl / initialCushionPct) * 100))
      : 50
    const flash = cushionToSl < 0.5 && cushionToSl > -0.5
    return {
      phase: 'red',
      fillPct: fill,
      label: `${cushionToSl.toFixed(2)}% to Stop Loss`,
      sublabel: '',
      flash,
      badges,
    }
  }

  // ─── Branch by archetype ───────────────────────────────────────────────
  if (archetype === 'A_TRAIL_ONLY' || archetype === 'B_TRAIL_PLUS_BE') {
    return trailArchetypePhase({
      cfg, pnlPct, mfePct, badges, beMovedFromState,
    })
  }
  if (archetype === 'C_BE_ONLY') {
    return beOnlyArchetypePhase({
      cfg, pnlPct, mfePct, badges, beMovedFromState,
    })
  }
  if (archetype === 'D_RSI_SL_ONLY') {
    return rsiSlOnlyArchetypePhase({
      cfg, pnlPct, mfePct, badges,
    })
  }

  // UNKNOWN archetype — show plain MFE without exit framing
  return {
    phase: pnlPct > 0 ? 'yellow' : 'idle',
    fillPct: Math.max(0, Math.min(100, pnlPct * 10)),
    label: `MFE ${(mfePct ?? 0).toFixed(2)}%`,
    sublabel: 'Holding — exit logic unknown',
    flash: false,
    badges,
  }
}

/** Archetype A (Trail only) + B (Trail + BE) shared trail logic.
 *  Yellow = MFE > 0, below trail activation. Green = trail active. */
function trailArchetypePhase(args: {
  cfg: CfgDims
  pnlPct: number
  mfePct: number | null
  badges: ProgressBadge[]
  beMovedFromState: boolean
}): ProgressBarState {
  const { cfg, pnlPct, mfePct, badges } = args
  // 2026-05-27 fix (Chris caught): engine writes mfe_abs to state.json only at
  // bar close (4h / 2h / 1h cadence). If current price is making a new
  // favorable high intra-bar, the engine's mfe_abs lags. Take max of engine
  // MFE and current favorable PnL so the displayed value tracks the live
  // peak — matches customer intuition + remains accurate (engine catches up
  // at next bar close anyway).
  const mfe = Math.max(mfePct ?? 0, Math.max(0, pnlPct))
  const trailLabel = trailModeLabel(cfg.trail_mode)
  const activation = trailActivationPct(cfg.trail_mode)

  if (cfg.trail_mode === 'multi_tier') {
    const lvl = multiTierLevel(mfe)
    if (lvl.tier === 0) {
      // Yellow — approaching first tier
      const fill = activation > 0 ? Math.max(0, Math.min(100, (mfe / activation) * 100)) : 0
      const need = (activation - mfe).toFixed(2)
      return {
        phase: 'yellow',
        fillPct: fill,
        label: `${need}% to arm ${trailLabel}`,
        sublabel: `MFE ${mfe.toFixed(2)}%`,
        flash: false,
        badges,
      }
    }
    // Green — trail active at tier `lvl.tier`
    // Per Chris (label tweak): "X% retrace allowed" mirrors engine reality
    // honestly. Exit triggers if price retraces lvl.retracePct of MFE from peak.
    return {
      phase: 'green',
      fillPct: 100,
      label: `${trailLabel} active`,
      sublabel: `Tier ${lvl.tier} · ${lvl.retracePct}% retrace allowed · peak ${mfe.toFixed(2)}%`,
      flash: false,
      badges,
    }
  }

  // chandelier / atr_2 / fixed_3pct — single threshold
  if (mfe < activation) {
    const fill = activation > 0 ? Math.max(0, Math.min(100, (mfe / activation) * 100)) : 0
    const need = Math.max(0, activation - mfe).toFixed(2)
    return {
      phase: 'yellow',
      fillPct: fill,
      label: activation > 0 ? `${need}% to ${trailLabel}` : `Building MFE`,
      sublabel: `MFE ${mfe.toFixed(2)}%`,
      flash: false,
      badges,
    }
  }
  return {
    phase: 'green',
    fillPct: 100,
    label: `${trailLabel} active`,
    sublabel: `Peak ${mfe.toFixed(2)}%`,
    flash: false,
    badges,
  }
}

/** Archetype C (Breakeven only) — exit is RSI TP or strong-alert.
 *  Yellow = MFE > 0, below gate threshold. Green = gate passed OR near RSI TP. */
function beOnlyArchetypePhase(args: {
  cfg: CfgDims
  pnlPct: number
  mfePct: number | null
  badges: ProgressBadge[]
  beMovedFromState: boolean
}): ProgressBarState {
  const { cfg, pnlPct, mfePct, badges, beMovedFromState } = args
  // 2026-05-27: live-peak max (see trailArchetypePhase comment).
  const mfe = Math.max(mfePct ?? 0, Math.max(0, pnlPct))
  const gateMfe = strongAlertGateMfeThreshold(cfg.strong_alert_gate)

  if (mfe < gateMfe && cfg.strong_alert_gate !== 'baseline' && cfg.strong_alert_gate !== 'off') {
    const fill = gateMfe > 0 ? Math.max(0, Math.min(100, (mfe / gateMfe) * 100)) : 0
    const need = (gateMfe - mfe).toFixed(2)
    return {
      phase: 'yellow',
      fillPct: fill,
      label: `${need}% to arm Take-profit`,
      sublabel: beMovedFromState ? 'Breakeven moved · MFE ' + mfe.toFixed(2) + '%' : `MFE ${mfe.toFixed(2)}%`,
      flash: false,
      badges,
    }
  }
  // Green — gate passed OR baseline gate (always armed when in profit)
  return {
    phase: 'green',
    fillPct: 100,
    label: 'Exit signals armed',
    sublabel: beMovedFromState ? `Breakeven moved · MFE ${mfe.toFixed(2)}%` : `MFE ${mfe.toFixed(2)}%`,
    flash: false,
    badges,
  }
}

/** Archetype D (RSI + hard SL only) — pure RSI exit OR strong-alert TP.
 *  No trail, no breakeven. Yellow = building MFE, green = exit armed. */
function rsiSlOnlyArchetypePhase(args: {
  cfg: CfgDims
  pnlPct: number
  mfePct: number | null
  badges: ProgressBadge[]
}): ProgressBarState {
  const { cfg, pnlPct, mfePct, badges } = args
  // 2026-05-27: live-peak max (see trailArchetypePhase comment).
  const mfe = Math.max(mfePct ?? 0, Math.max(0, pnlPct))
  const gateMfe = strongAlertGateMfeThreshold(cfg.strong_alert_gate)

  // No trail/BE on this archetype — only RSI TP + strong-alert TP + hard SL
  if (mfe < gateMfe && cfg.strong_alert_gate !== 'baseline' && cfg.strong_alert_gate !== 'off') {
    const fill = gateMfe > 0 ? Math.max(0, Math.min(100, (mfe / gateMfe) * 100)) : 0
    const need = (gateMfe - mfe).toFixed(2)
    return {
      phase: 'yellow',
      fillPct: fill,
      label: `${need}% to arm Take-profit`,
      sublabel: `MFE ${mfe.toFixed(2)}% · awaiting RSI`,
      flash: false,
      badges,
    }
  }
  return {
    phase: 'green',
    fillPct: 100,
    label: 'Exit signals armed',
    sublabel: `MFE ${mfe.toFixed(2)}% · RSI-driven exit`,
    flash: false,
    badges,
  }
}
