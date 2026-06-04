/**
 * bracketLayout.ts — SVG bracket coordinate system
 *
 * All pure functions. No React. Fully testable.
 *
 * Coordinate origin: top-left of the SVG body area (below headers).
 *
 *   cardLX(ci)              → left X of any card in column ci
 *   cardCY(i, count, h)     → centre Y of the i-th card in a column
 *   cardTY(i, count, h)     → top Y of the i-th card
 *   bodyH(n)                → total body height for n first-round matches
 */

import type { MatchEntry } from "@/types/config";
import { getRoundLabel } from "@/lib/fixtureEngine";

// ── Card dimensions ────────────────────────────────────────────────────────────
export const CARD_W = 180;   // card width  (px)
export const CARD_H = 72;    // card height = 2 × SLOT_H + DIV_H
export const SLOT_H = 32;    // each team slot
export const DIV_H  = 8;     // score divider bar between the two slots

// ── Bracket geometry ───────────────────────────────────────────────────────────
export const STUB  = 20;                        // horizontal connector arm on each side
export const COL_W = CARD_W + STUB * 2 + 8;    // column pitch  (card + both stubs + gap)
export const HDR_H = 40;                        // round-header area above the body
export const VPAD  = 16;                        // vertical padding at top & bottom of body
export const GAP   = 16;                        // minimum gap between cards in round 1

// ── Connector style ────────────────────────────────────────────────────────────
export const LINE_COLOR  = "#94a3b8";
export const LINE_W      = 2;
export const LINE_WIN    = "var(--color-primary)";
export const LINE_WIN_W  = 2.5;

// ── Coordinate functions ───────────────────────────────────────────────────────

/** Total SVG body height for n first-round matches. */
export function bodyH(n: number): number {
  return n * CARD_H + Math.max(0, n - 1) * GAP + VPAD * 2;
}

/** Centre Y of the i-th card in a column that has `count` cards, body height `h`. */
export function cardCY(i: number, count: number, h: number): number {
  const pitch = (h - VPAD * 2) / count;
  return VPAD + pitch * i + pitch / 2;
}

/** Top Y of the i-th card. */
export function cardTY(i: number, count: number, h: number): number {
  return cardCY(i, count, h) - CARD_H / 2;
}

/** Left X of cards in column `ci`. */
export function cardLX(ci: number): number {
  return ci * COL_W + STUB;
}

// ── KO spec builder ────────────────────────────────────────────────────────────

export type Spec = {
  round: number;
  label: string;
  count: number;
  matches: MatchEntry[];
};

/**
 * Build the ordered list of round specs for the bracket.
 * Existing rounds come from real match data; future rounds are projected as empty placeholders.
 */
export function buildSpecs(koMatches: MatchEntry[], totalAdvancing: number): Spec[] {
  const existing = [...new Set(koMatches.map(m => m.round))].sort((a, b) => a - b);
  const specs: Spec[] = [];

  if (existing.length > 0) {
    for (const r of existing) {
      const rm = koMatches.filter(m => m.round === r);
      specs.push({ round: r, label: rm[0].roundLabel, count: rm.length, matches: rm });
    }
    // Project remaining rounds until we reach the final (1 match)
    let rem = specs[specs.length - 1].count;
    let nr  = Math.max(...existing) + 1;
    while (rem > 1) {
      rem = Math.ceil(rem / 2);
      specs.push({ round: nr, label: getRoundLabel(rem), count: rem, matches: [] });
      nr++;
    }
  } else {
    // No matches yet — project all rounds from advancing count
    let n = totalAdvancing, r = 1;
    while (n > 1) {
      const mc = Math.ceil(n / 2);
      specs.push({ round: r, label: getRoundLabel(mc), count: mc, matches: [] });
      n = mc; r++;
    }
  }

  return specs;
}