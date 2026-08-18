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
  /** GREEN phase only. 0-100 position of the TRAIL marker on an entry->MFE bar.
   *  null when the trail level is not derivable from the cfg alone (ATR-based
   *  modes need the engine's live ATR — we do not invent one). */
  markerPct?: number | null
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

/** The TRAIL LEVEL expressed as a return-% from entry, for the green-phase marker.
 *
 *  multi_tier — the trail gives back `retracePct` of the PEAK, so it sits at
 *    mfe * (1 - retracePct/100) in return space. Matches the "50% retrace allowed" sublabel.
 *  fixed_3pct — engine.py:1085-1097 `_compute_trail_price` returns mfe_price * (1 ∓ 0.03),
 *    i.e. 3% off the peak PRICE, not 3 percentage points off the peak return. Converted here
 *    in price space and direction-correctly, because for a short the two differ.
 *  chandelier / atr_2 — ATR-based. The distance depends on the engine's live ATR, which the
 *    dashboard does not have. Returns null: NO MARKER rather than an invented one.
 */
export function trailLevelPct(trailMode: string, mfePct: number,
                              side: 'LONG' | 'SHORT'): number | null {
  if (!Number.isFinite(mfePct) || mfePct <= 0) return null
  if (trailMode === 'multi_tier') {
    const lvl = multiTierLevel(mfePct)
    if (lvl.tier === 0) return null
    return mfePct * (1 - lvl.retracePct / 100)
  }
  if (trailMode === 'fixed_3pct') {
    const D = 0.03
    // peak price relative to entry (entry = 1.0), then the trail 3% off it, back to return-%.
    return side === 'LONG'
      ? ((1 + mfePct / 100) * (1 - D) - 1) * 100
      : (1 - (1 - mfePct / 100) * (1 + D)) * 100
  }
  return null   // ATR-based — not derivable from the cfg
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
  /** Bars held since entry. Required for time_gt_6bars / mfe_and_time; null = unknown -> fail closed. */
  barsHeld?: number | null
  /** STICKY high-water peak %, held by the caller across renders and never allowed to fall while
   *  the position is open. Distinct from cfg.mfe_pct, which is the ENGINE's committed peak and
   *  only advances at bar close. Without this the displayed peak was recomputed every render as
   *  max(committed, now), so at a new high peak == now and the bar pinned at 100%, and any
   *  intra-bar peak was forgotten the moment price ticked down (Chris, ONDO, 2026-08-17).
   *  Falls back to the old behaviour when the caller does not supply it. */
  peakPct?: number | null
  /** Milliseconds until the current bar closes — when the running high COMMITS as MFE and the
   *  trail steps. Rendered as h:mm beside the uncommitted figure so the wait is visible. */
  commitsInMs?: number | null
  cfg: CfgDims
  side: 'LONG' | 'SHORT'
  entryPx: number
  slPx: number | null
  mfePct: number | null
  beMovedFromState: boolean
  currentPx: number
}): ProgressBarState | null {
  const { cfg, side, entryPx, slPx, mfePct, beMovedFromState, currentPx } = args
  const barsHeld = args.barsHeld ?? null
  const peakPct = args.peakPct ?? null
  const commitsInMs = args.commitsInMs ?? null
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
    // 2026-08-16 FIX (Chris caught it on HYPE). MFE threshold was the ONLY test, but two of
    // the four gated values are not pure-MFE gates:
    //   time_gt_6bars -> threshold 0, so livePeakMfe >= 0 is TRUE for every non-negative
    //                   position: the badge was PERMANENTLY armed from open.  7 of the 70.
    //   mfe_and_time  -> needs BOTH MFE>=2% AND bars>=6; the bars half was never checked
    //                   anywhere in this file despite the comment claiming it was. 16 of 70.
    // Fail CLOSED: barsHeld unknown -> do NOT arm a time-gated badge.
    const needsBars = (cfg.strong_alert_gate === 'time_gt_6bars'
                    || cfg.strong_alert_gate === 'mfe_and_time')
    // engine.py:1056-1059 is `bars_held > 6` — STRICTLY greater. Mirror it exactly.
    const barsOk = needsBars ? (barsHeld != null && barsHeld > 6) : true
    const gatePassed = livePeakMfe >= gateMfe && barsOk
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
      cfg, side, entryPx, pnlPct, mfePct, peakPct, commitsInMs, badges, beMovedFromState,
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

/** The PRICE at which MFE reaches `gatePct` — direction-aware. MFE is measured from entry, so a
 *  long needs entry x (1 + g) and a short entry x (1 - g). */
function gatePx(entryPx: number, side: 'LONG' | 'SHORT', gatePct: number): number | null {
  if (!Number.isFinite(entryPx) || entryPx <= 0 || !Number.isFinite(gatePct) || gatePct <= 0) return null
  return side === 'LONG' ? entryPx * (1 + gatePct / 100) : entryPx * (1 - gatePct / 100)
}

/** YELLOW phase — LIVE, not ratcheted (2026-08-16, Chris caught it on ONDO).
 *
 *  THE BUG THIS REPLACES. Every yellow return computed its fill AND its "X% to arm" label from
 *  `mfe` — a HIGH-WATER MARK that never decreases. So once ONDO's peak touched 1.29% against a
 *  1.5% gate, the bar froze at 86% and the label froze at "0.21% to arm" — unchanged whether
 *  price sat at +0.16% or +1.13%. Chris watched it not move across a 0.97pp swing. A bar that
 *  cannot go down is not a progress bar, it is a record of the best moment of the trade.
 *
 *  TWO NUMBERS ARE TRUE HERE AND THEY ARE NOT THE SAME:
 *    · threshold − mfe    = how much further the PEAK must extend      (0.21% for ONDO)
 *    · threshold − pnlPct = how far PRICE must travel from where it is (1.34% for ONDO)
 *  The gate fires on the peak, but the question a trader is asking is the second one. So the
 *  headline is the LIVE distance, the fill tracks LIVE price, and the peak is preserved as the
 *  marker + in the sublabel — nothing is lost, and the bar breathes.
 */
function armingBar(args: {
  label: string
  threshold: number
  pnlPct: number
  mfe: number
  /** The ENGINE's COMMITTED peak — the only value that can arm the trail. */
  mfeCommitted: number
  /** The PRICE at which MFE reaches the gate — what the trader actually watches. */
  armPx?: number | null
  commitsInMs?: number | null
  extraSub?: string
  badges: ProgressBadge[]
}): ProgressBarState {
  const { label, threshold, pnlPct, mfe, mfeCommitted, armPx, commitsInMs, extraSub,
          badges } = args
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  const live = Math.max(0, pnlPct)
  // FILL = progress of the COMMITTED peak toward the gate, so a FULL yellow bar always means
  // "about to arm" and can never sit at 100% while the trail is unarmed (SEI showed exactly that:
  // live 1.83% past a 1.50% gate filled the bar while the committed peak was only 0.39%).
  // The LIVE price is the moving marker instead — the bar still breathes every tick, but the
  // thing that fills is the thing that arms.
  const fill = threshold > 0 ? clamp((mfeCommitted / threshold) * 100) : 0
  const liveMark = threshold > 0 ? clamp((live / threshold) * 100) : null
  // 2026-08-17 (Chris, SEI): this printed "0.00% to arm Trailing TP" while the bar stayed YELLOW.
  // The contradiction was mine — the arm/no-arm DECISION uses the engine's COMMITTED peak
  // (mfeCommitted, which only advances at bar close), but the caption computed its distance from
  // the sticky intra-bar peak. SEI: committed 0.39% vs intra-bar 3.00% against a 1.50% gate, so
  // the engine correctly did not arm while the label claimed it should have.
  // Now: the headline distance and the marker both come from the COMMITTED peak — the only value
  // that can arm anything — and the uncommitted high is named separately with its bar-close
  // countdown, exactly as the green phase does.
  const needCommitted = Math.max(0, threshold - mfeCommitted)
  const marker = threshold > 0 ? clamp((mfeCommitted / threshold) * 100) : null
  // 2026-08-18 (Chris): "at what price does the trail turn on?" — the caption gave a percentage
  // and no price. Worse, MFE is the bar's EXTREME, not its close, so once the intra-bar high has
  // cleared the gate the trail arms AT THE CLOSE no matter where price sits then. Saying
  // "1.16% to arm" in that state is wrong: nothing more is needed. OP and SEI were both already
  // past their arm price (0.082034 / 0.038801) while the label still asked for 1.16% / 1.11%.
  const armed = mfe >= threshold - 1e-9
  let when = ''
  if (commitsInMs != null && commitsInMs > 0) {
    const mins = Math.floor(commitsInMs / 60000)
    when = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
  }
  const px = (v: number) => v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6)
  const bits: string[] = []
  if (extraSub) bits.push(extraSub)
  bits.push(`MFE ${mfeCommitted.toFixed(2)}%`, `now ${pnlPct.toFixed(2)}%`)
  if (mfe - mfeCommitted > 0.005) {
    bits.push(`high ${mfe.toFixed(2)}%${armed ? '' : ' uncommitted'}${when && !armed ? ` in ${when}` : ''}`)
  }
  if (armPx != null && !armed) bits.push(`arms at ${px(armPx)}`)
  return {
    phase: 'yellow',
    fillPct: fill,
    // The mark is LIVE price against the gate; the fill is the committed peak.
    markerPct: liveMark,
    label: threshold <= 0 ? 'Building MFE'
      // The high already cleared the gate: it arms when the bar closes, price is irrelevant now.
      : armed ? `${label} arms at close${when ? ` — ${when}` : ''}`
      : `${needCommitted.toFixed(2)}% to arm ${label} (${armPx != null ? px(armPx) : '—'})`,
    sublabel: bits.join(' · '),
    flash: false,
    badges,
  }
}

/** GREEN phase, to Chris's spec (2026-08-16).
 *
 *  The bar spans ENTRY -> MFE, not 0->100% of some abstract progress:
 *    · green fill  = (pnlPct / mfe) * 100  — a retrace RECEDES toward the marker
 *    · black marker= (trailPct / mfe) * 100 — where the trail would take us out
 *    · sublabel    = the live gap between the two
 *  When price is at a new peak, fill == 100 and the bar is full. When price gives
 *  back, the fill falls toward the marker; when it reaches the marker, the trail fires.
 *  Lag-corrected mfe is passed in by the caller (same correction the yellow phase uses).
 */
function greenTrailBar(args: {
  trailLabel: string
  mfe: number
  /** The engine's COMMITTED peak — the value the trail is actually derived from. */
  mfeEffective: number
  pnlPct: number
  trailPct: number | null
  extraSub?: string
  commitsInMs?: number | null
  badges: ProgressBadge[]
}): ProgressBarState {
  const { trailLabel, mfe, mfeEffective, pnlPct, trailPct, extraSub, badges,
          commitsInMs } = args
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  const fill = mfe > 0 ? clamp((pnlPct / mfe) * 100) : 100
  const marker = trailPct != null && mfe > 0 ? clamp((trailPct / mfe) * 100) : null
  // Kept SHORT deliberately: this caption sits in a narrow table cell, and a long one used to
  // force the whole table wider (the HYPE ATR row's horizontal scrollbar, 2026-08-16). The CSS
  // now wraps rather than expands, but a caption that fits on one line is still the better fix.
  // 2026-08-17 (Chris): "if the trail hasn't tightened, 2.71% is not the MFE in effect - both
  // can't be true". Correct, and the fault was this label. Two DISTINCT quantities:
  //   MFE in effect  = the engine's COMMITTED peak; engine.py:1526 computes the trail from it
  //   running high   = a real extreme already reached, which engine.py:1730 only commits at the
  //                    bar's CLOSE - at which point the trail tightens
  // Calling the running high "peak" implied it was the MFE, which contradicted the trail level
  // sitting below it. Name both, and only call the committed one MFE.
  const bits: string[] = []
  if (extraSub) bits.push(extraSub)
  if (trailPct != null) {
    const gap = pnlPct - trailPct
    bits.push(`MFE ${mfeEffective.toFixed(2)}% -> trail ${trailPct.toFixed(2)}%`)
    bits.push(gap >= 0 ? `now ${pnlPct.toFixed(2)}% (+${gap.toFixed(2)}%)`
                       : `now ${pnlPct.toFixed(2)}% (CROSSED ${(-gap).toFixed(2)}%)`)
  } else {
    bits.push(`MFE ${mfeEffective.toFixed(2)}% · trail ATR-based`, `now ${pnlPct.toFixed(2)}%`)
  }
  // Only worth showing when an uncommitted extreme is genuinely ahead of the committed MFE.
  if (mfe - mfeEffective > 0.005) {
    // h:mm to bar close — when this high commits as MFE and the trail steps. Chris asked for
    // hours and minutes only; seconds would churn the caption every render for no information.
    let when = ''
    if (commitsInMs != null && commitsInMs > 0) {
      const mins = Math.floor(commitsInMs / 60000)
      when = ` in ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
    }
    bits.push(`high ${mfe.toFixed(2)}% uncommitted${when}`)
  }
  return {
    phase: 'green',
    fillPct: fill,
    markerPct: marker,
    label: `${trailLabel} active`,
    sublabel: bits.join(' · '),
    flash: false,
    badges,
  }
}

/** Archetype A (Trail only) + B (Trail + BE) shared trail logic.
 *  Yellow = MFE > 0, below trail activation. Green = trail active. */
function trailArchetypePhase(args: {
  cfg: CfgDims
  side: 'LONG' | 'SHORT'
  entryPx: number
  pnlPct: number
  mfePct: number | null
  peakPct?: number | null
  commitsInMs?: number | null
  badges: ProgressBadge[]
  beMovedFromState: boolean
}): ProgressBarState {
  const { cfg, side, entryPx, pnlPct, mfePct, peakPct, commitsInMs, badges } = args
  // 2026-05-27 fix (Chris caught): engine writes mfe_abs to state.json only at
  // bar close (4h / 2h / 1h cadence). If current price is making a new
  // favorable high intra-bar, the engine's mfe_abs lags. Take max of engine
  // MFE and current favorable PnL so the displayed value tracks the live
  // peak — matches customer intuition + remains accurate (engine catches up
  // at next bar close anyway).
  const mfe = peakPct != null
    ? Math.max(peakPct, mfePct ?? 0)            // STICKY high-water — never falls on a retrace
    : Math.max(mfePct ?? 0, Math.max(0, pnlPct))
  // 2026-08-16 — established from engine source, not assumed.
  //   engine.py:1734/1739  MFE is the bar's HIGH (long) / LOW (short), so a TOUCH is enough:
  //                        price never has to hold to the close for the peak to count.
  //   engine.py:1526/1531  the trail is computed from `mfe_abs`, and the MFE update at :1730
  //                        happens LATER in the same `for t` loop (:1314). So within bar t the
  //                        trail uses the peak through bar t-1 — it steps at bar boundaries and
  //                        NEVER moves intra-bar.
  // state.json is written at bar close of t carrying the peak through t, which is exactly the
  // engine's input for bar t+1. So the COMMITTED mfe (raw mfePct, no live correction) is the
  // faithful input for the trail level and the tier. The lag-corrected `mfe` above is for
  // DISPLAYING the peak only — using it for the trail would draw a mark that moves intra-bar
  // when the engine's does not.
  const mfeCommitted = Math.max(0, mfePct ?? 0)
  const trailLabel = trailModeLabel(cfg.trail_mode)
  const activation = trailActivationPct(cfg.trail_mode)

  if (cfg.trail_mode === 'multi_tier') {
    const lvl = multiTierLevel(mfeCommitted)
    if (lvl.tier === 0) {
      // Yellow — approaching first tier. LIVE (see armingBar).
      return armingBar({
        label: trailLabel, threshold: activation, pnlPct, mfe, mfeCommitted, commitsInMs, badges,
        armPx: gatePx(entryPx, side, activation),
      })
    }
    // Green — trail active at tier `lvl.tier`. Bar spans entry -> MFE with the trail marked.
    return greenTrailBar({
      trailLabel, mfe, mfeEffective: mfeCommitted, pnlPct, badges, commitsInMs,
      trailPct: trailLevelPct(cfg.trail_mode, mfeCommitted, side),
      // `T1` not `Tier 1 · 60% retrace allowed` — the long form pushed this caption to 83 chars,
      // wider than the HYPE row that produced the scrollbar. The retrace % lives in the tooltip.
      extraSub: `T${lvl.tier}`,
    })
  }

  // chandelier / atr_2 / fixed_3pct — single threshold
  if (mfeCommitted < activation) {
    return armingBar({
      label: trailLabel, threshold: activation, pnlPct, mfe, mfeCommitted, commitsInMs, badges,
      armPx: gatePx(entryPx, side, activation),
    })
  }
  return greenTrailBar({
    trailLabel, mfe, mfeEffective: mfeCommitted, pnlPct, badges, commitsInMs,
    trailPct: trailLevelPct(cfg.trail_mode, mfeCommitted, side),
  })
}

/** Archetype C (Breakeven only) — exit is RSI TP or strong-alert.
 *  Yellow = MFE > 0, below gate threshold. Green = gate passed OR near RSI TP. */
function beOnlyArchetypePhase(args: {
  cfg: CfgDims
  pnlPct: number
  mfePct: number | null
  commitsInMs?: number | null
  badges: ProgressBadge[]
  beMovedFromState: boolean
}): ProgressBarState {
  const { cfg, pnlPct, mfePct, badges, beMovedFromState } = args
  // 2026-05-27: live-peak max (see trailArchetypePhase comment).
  const mfe = Math.max(mfePct ?? 0, Math.max(0, pnlPct))
  const gateMfe = strongAlertGateMfeThreshold(cfg.strong_alert_gate)

  if (mfe < gateMfe && cfg.strong_alert_gate !== 'baseline' && cfg.strong_alert_gate !== 'off') {
    return armingBar({
      label: 'Take-profit', threshold: gateMfe, pnlPct, mfe, badges,
      mfeCommitted: Math.max(0, mfePct ?? 0), commitsInMs: args.commitsInMs,
      extraSub: beMovedFromState ? 'Breakeven moved' : undefined,
    })
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
  commitsInMs?: number | null
  badges: ProgressBadge[]
}): ProgressBarState {
  const { cfg, pnlPct, mfePct, badges } = args
  // 2026-05-27: live-peak max (see trailArchetypePhase comment).
  const mfe = Math.max(mfePct ?? 0, Math.max(0, pnlPct))
  const gateMfe = strongAlertGateMfeThreshold(cfg.strong_alert_gate)

  // No trail/BE on this archetype — only RSI TP + strong-alert TP + hard SL
  if (mfe < gateMfe && cfg.strong_alert_gate !== 'baseline' && cfg.strong_alert_gate !== 'off') {
    return armingBar({
      label: 'Take-profit', threshold: gateMfe, pnlPct, mfe, badges,
      mfeCommitted: Math.max(0, mfePct ?? 0), commitsInMs: args.commitsInMs,
      extraSub: 'awaiting RSI',
    })
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
