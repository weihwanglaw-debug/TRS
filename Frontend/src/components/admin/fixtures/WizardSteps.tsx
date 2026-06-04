/**
 * WizardSteps.tsx — 2-screen fixture wizard
 *
 * Screen 1: Participant list + format + seeding (all on one page)
 * Screen 2: Preview bracket + swap + Confirm & Save
 *
 * SBA lookup: SBA ID only. Auto-fill only assigns participants that have an SBA ID.
 */

import React, { useState, useMemo, useEffect } from "react";
import { ChevronRight, ChevronLeft, Shuffle, CheckCircle, ArrowLeftRight } from "lucide-react";
import type { SeedEntry, WizardConfig, SbaRanking, BracketState, TeamEntry, HeatsConfig, StandingPoints } from "@/types/config";
import { generateDraw, swapTeams, computeGroupStandings } from "@/lib/fixtureEngine";
import { NoticeDialog } from "@/components/ui/NoticeDialog";

export interface WizardResult {
  config:  WizardConfig;
  seeds:   SeedEntry[];
  bracket: BracketState;
}

interface Props {
  participants: SeedEntry[];
  sbaRankings:  SbaRanking[];
  isBadminton:  boolean;
  onComplete:   (r: WizardResult) => void;
  onCancel:     () => void;
}

// ── Format definitions ────────────────────────────────────────────────────────

const FORMATS: { value: WizardConfig["format"]; label: string; desc: string; needsSeeds: boolean }[] = [
  { value: "knockout",       label: "Knockout",        desc: "Single elimination — each loss = out.", needsSeeds: true  },
  { value: "group_knockout", label: "Group + Knockout", desc: "Round-robin groups → top teams advance to KO bracket.", needsSeeds: true  },
  { value: "round_robin",    label: "Round Robin",      desc: "Everyone plays everyone. Final standings only.", needsSeeds: false },
  { value: "heats",          label: "Heats",            desc: "Individual rounds — no head-to-head. Results decide who advances.", needsSeeds: false },
];

function matchSbaRanking(seed: SeedEntry, rankings: SbaRanking[]) {
  const ids = (seed.sbaIds?.length ? seed.sbaIds : seed.sbaId ? [seed.sbaId] : [])
    .map(id => id.toUpperCase());
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    return rankings.find(r => r.player1.sbaId.toUpperCase() === ids[0] && !r.player2) ?? null;
  }
  const set = new Set(ids);
  return rankings.find(r => r.player2 && set.has(r.player1.sbaId.toUpperCase()) && set.has(r.player2.sbaId.toUpperCase())) ?? null;
}

// ── Screen 1: Configure ───────────────────────────────────────────────────────

function ScreenConfigure({ participants, sbaRankings, isBadminton, onNext, onCancel }: {
  participants: SeedEntry[];
  sbaRankings:  SbaRanking[];
  isBadminton:  boolean;
  onNext:       (config: WizardConfig, seeds: SeedEntry[]) => void;
  onCancel:     () => void;
}) {
  const [format, setFormat]     = useState<WizardConfig["format"]>("knockout");
  const [numSeeds, setNumSeeds] = useState(0);
  const [numGroups, setNumGroups] = useState(2);
  const [advancePerGroup, setAdvancePerGroup] = useState(2);
  const [standingPoints, setStandingPoints]   = useState<StandingPoints>({ win: 2, draw: 1, loss: 0 });
  const [heatsConfig, setHeatsConfig]         = useState<HeatsConfig>({ numRounds: 2, advancePerRound: 4, resultLabel: "Result", placesAwarded: 3 });
  const [seeds, setSeeds] = useState<SeedEntry[]>(participants.map(p => ({ ...p })));
  const [notice, setNotice] = useState<{ title: string; description: string } | null>(null);

  const fmt      = FORMATS.find(f => f.value === format)!;
  const showSeeds = fmt.needsSeeds && numSeeds > 0;
  const count    = participants.length;

  const getSba = (s: SeedEntry) => matchSbaRanking(s, sbaRankings);

  useEffect(() => {
    setSeeds(participants.map(p => ({ ...p })));
  }, [participants]);

  const handleFormatChange = (f: WizardConfig["format"]) => {
    setFormat(f);
    setNumSeeds(0);
    setSeeds(participants.map(p => ({ ...p })));
  };

  const autoSeed = () => {
    const withSba = seeds.filter(s => getSba(s));
    if (withSba.length === 0) {
      setNotice({ title: "Auto Seed Unavailable", description: "None of the participants have a registered SBA ID. Please assign seeds manually." });
      return;
    }
    const canAssign = Math.min(numSeeds, withSba.length);
    const sorted = [...withSba].sort((a, b) => (getSba(b)?.accumulatedScore ?? 0) - (getSba(a)?.accumulatedScore ?? 0));
    setSeeds(seeds.map(s => {
      const rank = sorted.findIndex(x => x.id === s.id);
      return { ...s, seed: rank >= 0 && rank < canAssign ? rank + 1 : null };
    }));
    if (canAssign < numSeeds) {
      setNotice({
        title: "Partial Auto Seed",
        description: `Only ${canAssign} of ${numSeeds} seeds could be auto-assigned (${numSeeds - canAssign} participant${numSeeds - canAssign > 1 ? "s have" : " has"} no SBA ID).`,
      });
    }
  };

  const setSeedValue = (id: string, val: string) =>
    setSeeds(seeds.map(s => s.id === id ? { ...s, seed: val === "" ? null : +val } : s));

  const seedNums = seeds.filter(s => s.seed !== null).map(s => s.seed as number);
  const hasDups  = seedNums.length !== new Set(seedNums).size;
  const outRange = seedNums.some(n => n < 1 || n > numSeeds);
  const canNext  = !hasDups && !outRange && count >= 2;

  const buildConfig = (): WizardConfig => ({
    format, numSeeds,
    numGroups:       format === "group_knockout" ? numGroups : undefined,
    advancePerGroup: format === "group_knockout" ? advancePerGroup : undefined,
    standingPoints:  format === "round_robin"    ? standingPoints : undefined,
    heatsConfig:     format === "heats"          ? heatsConfig : undefined,
  });

  return (
    <div className="space-y-6">

      {/* Format selector */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">Game Format</p>
        <div className="grid grid-cols-2 gap-3">
          {FORMATS.map(f => {
            const active = format === f.value;
            return (
              <button key={f.value} onClick={() => handleFormatChange(f.value)}
                className="text-left p-4"
                style={{
                  border: `2px solid ${active ? "var(--color-primary)" : "var(--color-table-border)"}`,
                  backgroundColor: active ? "var(--color-row-hover)" : "transparent",
                }}>
                <p className="font-bold text-sm mb-1" style={{ color: active ? "var(--color-primary)" : undefined }}>
                  {f.label}
                </p>
                <p className="text-xs opacity-60 leading-relaxed">{f.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Format-specific config */}
      {format === "group_knockout" && (
        <div className="grid grid-cols-2 gap-4 p-4"
          style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
          <div>
            <label className="block text-xs font-semibold mb-2 opacity-60">Number of Groups</label>
            <select className="field-input w-full" value={numGroups}
              onChange={e => setNumGroups(+e.target.value)}>
              {Array.from({ length: Math.min(Math.floor(count / 2), 8) }, (_, i) => i + 2).map(n => (
                <option key={n} value={n}>{n} groups (~{Math.ceil(count / n)} per group)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2 opacity-60">Advance Per Group</label>
            <select className="field-input w-full" value={advancePerGroup}
              onChange={e => setAdvancePerGroup(+e.target.value)}>
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <p className="text-xs opacity-40 mt-1">→ {numGroups * advancePerGroup} teams advance to KO</p>
          </div>
        </div>
      )}

      {format === "round_robin" && (
        <div className="p-4 space-y-3"
          style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
          <p className="text-xs font-bold uppercase tracking-wide opacity-50">Standing Points</p>
          <div className="grid grid-cols-3 gap-4">
            {(["win", "draw", "loss"] as const).map(k => (
              <div key={k}>
                <label className="block text-xs font-semibold mb-2 capitalize opacity-60">{k}</label>
                <input type="number" min={0} className="field-input w-full text-center"
                  value={standingPoints[k]}
                  onChange={e => setStandingPoints({ ...standingPoints, [k]: +e.target.value })} />
              </div>
            ))}
          </div>
        </div>
      )}

      {format === "heats" && (
        <div className="p-4 space-y-4"
          style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
          <p className="text-xs font-bold uppercase tracking-wide opacity-50">Heats Configuration</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-60">Total Rounds (incl. Final)</label>
              <input type="number" min={2} max={8} className="field-input w-full"
                value={heatsConfig.numRounds}
                onChange={e => setHeatsConfig({ ...heatsConfig, numRounds: +e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-60">Advance Per Round</label>
              <input type="number" min={1} className="field-input w-full"
                value={heatsConfig.advancePerRound}
                onChange={e => setHeatsConfig({ ...heatsConfig, advancePerRound: +e.target.value })} />
              <p className="text-xs opacity-40 mt-1">Except final round</p>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-60">Result Label</label>
              <input type="text" className="field-input w-full" placeholder="e.g. Time, Score, Distance"
                value={heatsConfig.resultLabel}
                onChange={e => setHeatsConfig({ ...heatsConfig, resultLabel: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-60">Places Awarded (Final)</label>
              <select className="field-input w-full" value={heatsConfig.placesAwarded}
                onChange={e => setHeatsConfig({ ...heatsConfig, placesAwarded: +e.target.value })}>
                <option value={1}>1st only</option>
                <option value={2}>1st & 2nd</option>
                <option value={3}>1st, 2nd & 3rd</option>
                <option value={4}>Top 4</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Seeding */}
      {fmt.needsSeeds && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">Seeding</p>
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div>
              <label className="block text-xs font-semibold mb-2 opacity-60">Number of Seeds</label>
              <select className="field-input w-48"
                value={numSeeds}
                onChange={e => {
                  const n = +e.target.value;
                  setNumSeeds(n);
                  if (n === 0) setSeeds(seeds.map(s => ({ ...s, seed: null })));
                }}>
                <option value={0}>No seeding (random draw)</option>
                {Array.from({ length: Math.min(count, 8) }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>Top {n} seed{n > 1 ? "s" : ""}</option>
                ))}
              </select>
            </div>
            {showSeeds && (
              <div className="self-end">
                <button onClick={autoSeed}
                  className="btn-outline flex items-center gap-2 px-4 py-2 text-xs font-medium">
                  <Shuffle className="h-3.5 w-3.5" />
                  {isBadminton ? "Auto-fill from SBA" : "Auto-fill by rank"}
                </button>
              </div>
            )}
          </div>

          {showSeeds && (hasDups || outRange) && (
            <p className="text-xs font-semibold mb-3 px-3 py-2"
              style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)", border: "1px solid var(--badge-closed-text)" }}>
              {hasDups ? "⚠ Duplicate seed numbers." : ""}
              {outRange ? ` ⚠ Seeds must be 1–${numSeeds}.` : ""}
            </p>
          )}
        </div>
      )}

      {/* Participant list */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">
          Participants ({count})
        </p>
        <div className="overflow-auto" style={{ border: "1px solid var(--color-table-border)", maxHeight: 340 }}>
          <table className="trs-table">
            <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
              <tr>
                <th>#</th>
                <th>Club / School / Org</th>
                <th>Player(s)</th>
                {isBadminton && <th>SBA ID</th>}
                {isBadminton && <th>SBA Score</th>}
                {showSeeds && <th style={{ width: 120 }}>Seed</th>}
              </tr>
            </thead>
            <tbody>
              {seeds.map((s, i) => {
                const sba    = getSba(s);
                const isDup  = showSeeds && s.seed !== null && seeds.filter(x => x.seed === s.seed).length > 1;
                return (
                  <tr key={s.id} style={isDup ? { backgroundColor: "var(--badge-closed-bg)" } : undefined}>
                    <td className="font-mono text-xs opacity-30">{i + 1}</td>
                    <td className="font-medium text-sm">{s.club}</td>
                    <td className="text-xs opacity-70">{s.participants.join(" / ")}</td>
                    {isBadminton && (
                      <td className="font-mono text-xs">
                        {s.sbaId
                          ? <span className="opacity-60">{s.sbaId}</span>
                          : <span className="italic opacity-25">No SBA ID</span>}
                      </td>
                    )}
                    {isBadminton && (
                      <td className="text-right font-mono text-xs">
                        {sba
                          ? <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>{sba.accumulatedScore.toLocaleString()}</span>
                          : <span className="opacity-25">—</span>}
                      </td>
                    )}
                    {showSeeds && (
                      <td>
                        <div className="flex items-center gap-1">
                          <input type="number" min={1} max={numSeeds}
                            className="field-input py-1 text-sm text-center"
                            style={{ width: "4rem", borderColor: isDup ? "var(--badge-closed-text)" : undefined }}
                            value={s.seed ?? ""} placeholder="—"
                            onChange={e => setSeedValue(s.id, e.target.value)} />
                          {s.seed !== null && (
                            <button onClick={() => setSeedValue(s.id, "")}
                              className="text-xs opacity-30 hover:opacity-70">✕</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {count < 2 && (
        <p className="text-xs px-3 py-2 font-semibold"
          style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
          ⚠ At least 2 entries required.
        </p>
      )}

      <div className="flex justify-between items-center pt-2"
        style={{ borderTop: "1px solid var(--color-table-border)" }}>
        <button onClick={onCancel} className="btn-outline px-4 py-2 text-xs opacity-60 hover:opacity-100">
          Cancel
        </button>
        <button onClick={() => canNext && onNext(buildConfig(), seeds)}
          disabled={!canNext}
          className="btn-primary flex items-center gap-2 px-6 py-2.5 text-sm font-semibold disabled:opacity-40">
          Preview Draw <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <NoticeDialog
        open={!!notice}
        onOpenChange={(open) => !open && setNotice(null)}
        title={notice?.title ?? ""}
        description={notice?.description ?? ""}
      />
    </div>
  );
}

// ── Screen 2: Preview + Swap + Confirm ───────────────────────────────────────

function ScreenPreview({ bracket, seeds, onSwap, onConfirm, onBack, saving }: {
  bracket:   BracketState;
  seeds:     SeedEntry[];
  onSwap:    (idA: string, idB: string) => void;
  onConfirm: () => void;
  onBack:    () => void;
  saving:    boolean;
}) {
  const [selA, setSelA]       = useState("");
  const [selB, setSelB]       = useState("");
  const [swapMsg, setSwapMsg] = useState<string | null>(null);

  const allTeams = useMemo<TeamEntry[]>(() => {
    const seen = new Map<string, TeamEntry>();
    const add  = (t: TeamEntry) => { if (t.id && !t.id.startsWith("bye") && !seen.has(t.id)) seen.set(t.id, t); };
    bracket.groups.flatMap(g => g.matches).forEach(m => { add(m.team1); add(m.team2); });
    bracket.matches.forEach(m => { add(m.team1); add(m.team2); });
    if (bracket.format === "heats") {
      seeds.forEach(s => seen.set(s.id, { id: s.id, label: s.club, participants: s.participants, seed: s.seed ?? undefined }));
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [bracket, seeds]);

  const handleSwap = () => {
    if (!selA || !selB || selA === selB) return;
    const ta = allTeams.find(t => t.id === selA);
    const tb = allTeams.find(t => t.id === selB);
    onSwap(selA, selB);
    setSwapMsg(`Swapped: ${ta?.label} ↔ ${tb?.label}`);
    setSelA(""); setSelB("");
    setTimeout(() => setSwapMsg(null), 3000);
  };

  // Heats preview
  const HeatsPreview = () => (
    <div style={{ border: "1px solid var(--color-table-border)" }}>
      <div className="px-4 py-2 font-bold text-xs uppercase tracking-wide"
        style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
        Participants — {bracket.heatRounds?.[0]?.results.length ?? 0} in Round 1
      </div>
      <table className="trs-table">
        <thead><tr><th>#</th><th>Club / School</th><th>Players</th><th>Seed</th></tr></thead>
        <tbody>
          {seeds.map((s, i) => (
            <tr key={s.id}>
              <td className="opacity-30 font-mono text-xs">{i + 1}</td>
              <td className="font-medium text-sm">{s.club}</td>
              <td className="text-xs opacity-60">{s.participants.join(" / ")}</td>
              <td>{s.seed != null
                ? <span className="text-xs font-bold px-1.5 py-0.5" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>#{s.seed}</span>
                : <span className="opacity-25 text-xs">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Group preview
  const GroupPreview = () => (
    <>
      {bracket.groups.map(grp => {
        const standings = computeGroupStandings(grp);
        return (
          <div key={grp.id} style={{ border: "1px solid var(--color-table-border)" }}>
            <div className="px-4 py-2 font-bold text-xs uppercase tracking-wide"
              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
              {grp.name}
            </div>
            <table className="trs-table">
              <thead><tr><th>#</th><th>Club / School</th><th>Players</th><th>Seed</th></tr></thead>
              <tbody>
                {standings.map(s => (
                  <tr key={s.team.id}>
                    <td className="font-bold text-sm">{s.rank}</td>
                    <td className="font-medium text-sm">{s.team.label}</td>
                    <td className="text-xs opacity-60">{s.team.participants.join(" / ")}</td>
                    <td>{s.team.seed != null
                      ? <span className="text-xs font-bold px-1.5 py-0.5" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>#{s.team.seed}</span>
                      : <span className="opacity-25 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );

  // KO round 1 preview
  const KoPreview = () => {
    const r1 = bracket.matches.filter(m => m.round === 1);
    if (!r1.length) return null;
    return (
      <div style={{ border: "1px solid var(--color-table-border)" }}>
        <div className="px-4 py-2 font-bold text-xs uppercase tracking-wide"
          style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>
          Round 1 Matchups
        </div>
        <table className="trs-table">
          <thead><tr><th>Match</th><th>Team 1</th><th className="text-center">vs</th><th>Team 2</th></tr></thead>
          <tbody>
            {r1.map((m, i) => (
              <tr key={m.id}>
                <td className="opacity-30 font-mono text-xs">{i + 1}</td>
                <td>
                  {m.team1.seed != null && <span className="text-xs font-bold px-1.5 py-0.5 mr-1" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>#{m.team1.seed}</span>}
                  <span className="font-medium text-sm">{m.team1.label}</span>
                </td>
                <td className="text-center opacity-25 font-bold text-xs">vs</td>
                <td>
                  {m.team2.seed != null && <span className="text-xs font-bold px-1.5 py-0.5 mr-1" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-hero-text)" }}>#{m.team2.seed}</span>}
                  <span className="font-medium text-sm">{m.team2.label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-sm">Preview Draw</p>
          <p className="text-xs opacity-50">Swap positions if needed, then confirm to save.</p>
        </div>
      </div>

      {/* Swap panel */}
      <div className="p-4" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
        <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">Swap Positions</p>
        {swapMsg && (
          <div className="text-xs font-semibold mb-3 px-3 py-2"
            style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}>
            ✓ {swapMsg}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-36">
            <label className="block text-xs font-semibold mb-1.5 opacity-60">Player A</label>
            <select className="field-input w-full" value={selA} onChange={e => setSelA(e.target.value)}>
              <option value="">Select…</option>
              {allTeams.map(t => (
                <option key={t.id} value={t.id} disabled={t.id === selB}>
                  {t.seed != null ? `[#${t.seed}] ` : ""}{t.label}
                </option>
              ))}
            </select>
          </div>
          <ArrowLeftRight className="h-4 w-4 opacity-25 flex-shrink-0 mb-1" />
          <div className="flex-1 min-w-36">
            <label className="block text-xs font-semibold mb-1.5 opacity-60">Player B</label>
            <select className="field-input w-full" value={selB} onChange={e => setSelB(e.target.value)}>
              <option value="">Select…</option>
              {allTeams.map(t => (
                <option key={t.id} value={t.id} disabled={t.id === selA}>
                  {t.seed != null ? `[#${t.seed}] ` : ""}{t.label}
                </option>
              ))}
            </select>
          </div>
          <button onClick={handleSwap} disabled={!selA || !selB || selA === selB}
            className="btn-outline flex items-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-30">
            <ArrowLeftRight className="h-4 w-4" /> Swap
          </button>
        </div>
      </div>

      {/* Bracket preview */}
      <div className="space-y-3">
        {bracket.format === "heats"         && <HeatsPreview />}
        {bracket.groups.length > 0          && <GroupPreview />}
        {bracket.matches.length > 0         && <KoPreview />}
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-2"
        style={{ borderTop: "1px solid var(--color-table-border)" }}>
        <button onClick={onBack} className="btn-outline flex items-center gap-2 px-5 py-2.5 text-sm">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <button onClick={onConfirm} disabled={saving}
          className="btn-primary flex items-center gap-2 px-6 py-2.5 text-sm font-semibold disabled:opacity-40">
          {saving
            ? <><div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
            : <><CheckCircle className="h-4 w-4" /> Confirm &amp; Save</>}
        </button>
      </div>
    </div>
  );
}

// ── Wizard container ──────────────────────────────────────────────────────────

export function FixtureWizard({ participants, sbaRankings, isBadminton, onComplete, onCancel }: Props) {
  const [screen,  setScreen]  = useState<1 | 2>(1);
  const [wConfig, setWConfig] = useState<WizardConfig | null>(null);
  const [wSeeds,  setWSeeds]  = useState<SeedEntry[]>([]);
  const [preview, setPreview] = useState<BracketState | null>(null);
  const [saving,  setSaving]  = useState(false);

  const goPreview = (config: WizardConfig, seeds: SeedEntry[]) => {
    setWConfig(config);
    setWSeeds(seeds);
    setPreview(generateDraw(seeds, config));
    setScreen(2);
  };

  const handleSwap = (idA: string, idB: string) => {
    if (preview) setPreview(swapTeams(preview, idA, idB));
  };

  const handleConfirm = async () => {
    if (!preview || !wConfig) return;
    setSaving(true);
    await new Promise(r => setTimeout(r, 60));
    onComplete({ config: wConfig, seeds: wSeeds, bracket: preview });
    setSaving(false);
  };

  // Step indicator
  const steps = ["Configure", "Preview"];

  return (
    <div>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = screen > n, active = screen === n;
          return (
            <React.Fragment key={n}>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-6 h-6 flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: active || done ? "var(--color-primary)" : "var(--color-table-border)",
                    color: active || done ? "var(--color-hero-text)" : "var(--color-body-text)",
                    opacity: done ? 0.6 : 1,
                  }}>
                  {done ? "✓" : n}
                </div>
                <span className="text-xs font-semibold hidden sm:block"
                  style={{ color: active ? "var(--color-primary)" : undefined, opacity: active ? 1 : done ? 0.4 : 0.3 }}>
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="flex-1 h-px" style={{ backgroundColor: "var(--color-table-border)" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {screen === 1 && (
        <ScreenConfigure
          participants={participants}
          sbaRankings={sbaRankings}
          isBadminton={isBadminton}
          onNext={goPreview}
          onCancel={onCancel}
        />
      )}
      {screen === 2 && preview && (
        <ScreenPreview
          bracket={preview}
          seeds={wSeeds}
          onSwap={handleSwap}
          onConfirm={handleConfirm}
          onBack={() => setScreen(1)}
          saving={saving}
        />
      )}
    </div>
  );
}
