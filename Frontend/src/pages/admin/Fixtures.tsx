/**
 * Fixtures.tsx - Fixture Management
 *
 * Program-level table. Each row = one program.
 * Columns: Event | Program | Mode | Event Date | Fixture | Action
 *
 * fixtureMode:
 *  internal  -> full wizard + Bracket/Table tabs
 *  external  -> seeding assignment + CSV export only
 *  not_required -> read-only row, no action
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, ArrowRight, Loader2, Download, Search, X, Shuffle } from "lucide-react";
import type { TournamentEvent, SeedEntry, BracketState, MatchEntry, WizardConfig, SbaRanking } from "@/types/config";
import { isBracketLocked, isPhaseComplete, getAllMatches, getCurrentHeatRound } from "@/lib/fixtureEngine";
import {
  apiGenerateDraw, apiGetFixture, apiResetFixture,
  apiGetFixtureStatus,
  apiSaveScore, apiClearScore, apiUpdateSchedule,
  apiAdvanceKnockoutRound, apiAdvanceToKnockout, apiResetLatestKnockoutRound, apiSwapTeams,
  apiSaveHeatResult, apiAdvanceHeatsRound, apiAssignHeatPlaces,
} from "@/lib/fixtureApi";
import type { ApiError } from "@/lib/fixtureApi";
import { groupsToSeedEntries } from "@/types/registration";
import type { Registration } from "@/types/registration";
import { computeProgramFixtureStatus } from "@/lib/fixtureStatus";
import { singaporeDateKey } from "@/lib/eventUtils";
import { getEntryDisplay } from "@/lib/entryDisplay";

import { exportParticipantsCsv } from "@/lib/exportCsv";
import { exportTournamentSoftwareWorkbook } from "@/lib/exportTournamentSoftwareWorkbook";
import { apiGetEvents, apiGetSbaRankings, apiGetRegistrations, apiUpdateGroupSeed } from "@/lib/api";

import { FixtureWizard } from "@/components/admin/fixtures/WizardSteps";
import type { WizardResult } from "@/components/admin/fixtures/WizardSteps";
import { DrawTab }     from "@/components/admin/fixtures/DrawTab";
import { ResultsTab }  from "@/components/admin/fixtures/ResultsTab";
import { ScoreModal }  from "@/components/admin/fixtures/ScoreModal";
import { HeatsTab }    from "@/components/admin/fixtures/HeatsTab";
import { FG }          from "@/components/admin/fixtures/shared";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import AdminTabs from "@/components/admin/AdminTabs";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

//  Types

type Tab = "draw" | "results" | "heats";

interface ProgramRow {
  eventId:     string;
  eventName:   string;
  programId:   string;
  programName: string;
  sbaRankingType?: string | null;
  mode:        string;
  sportType:   string;
  startDate:   string;
  endDate:     string;
  closeDate:   string;
  teamMode:    boolean;
  participants: SeedEntry[];
}
//  Status badges

function DrawBadge({ programId, closeDate, mode, fixtureExists }: {
  programId: string; closeDate: string; mode: string; fixtureExists: Record<string, boolean>;
}) {
  if (mode === "not_required") return <span className="text-xs opacity-30">Not Required</span>;
  if (mode === "external")     return <span className="text-xs opacity-50 italic">External</span>;
  const regClosed = singaporeDateKey() > closeDate;
  if (!regClosed)                     return <span className="text-xs opacity-30">Reg. Open</span>;
  if (!fixtureExists[programId])      return <span className="text-xs font-bold" style={{ color: "var(--badge-closed-text)" }}>● Pending</span>;
  return <span className="text-xs font-bold" style={{ color: "var(--badge-open-text)" }}>✓ Generated</span>;
}

function isByeMatch(m: MatchEntry) {
  return m.team1.label === "BYE" || m.team2.label === "BYE"
    || m.team1.id.startsWith("bye-") || m.team2.id.startsWith("bye-");
}

function isResolvedMatch(m: MatchEntry) {
  return m.status === "C" || m.status === "W" || isByeMatch(m);
}

function hasEnteredResult(m: MatchEntry) {
  if (isByeMatch(m)) return false;
  const status = m.status ?? "";
  const winner = m.winner ?? "";
  const walkoverWinner = m.walkoverWinner ?? "";
  const games = m.games ?? [];
  return status === "C" ||
    status === "W" ||
    winner !== "" ||
    m.walkover === true ||
    walkoverWinner !== "" ||
    games.some(g => (g.p1 ?? "") !== "" || (g.p2 ?? "") !== "");
}

function fixtureFormatLabel(format?: string) {
  switch ((format ?? "").toLowerCase()) {
    case "knockout": return "Knockout";
    case "group_knockout": return "Group + Knockout";
    case "round_robin": return "Round Robin";
    case "heats": return "Heats";
    default: return "Not generated";
  }
}

//  External seeding panel

function ExternalPanel({ participants, sbaRankings, isBadminton, onSeedsSaved, onExport, toastSuccess, toastError }: {
  participants: SeedEntry[]; sbaRankings: SbaRanking[]; isBadminton: boolean;
  onSeedsSaved: () => Promise<void>;
  onExport: () => Promise<void>;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
}) {
  const savedSeedCount = (items: SeedEntry[]) =>
    items.reduce((max, item) => item.seed != null ? Math.max(max, item.seed) : max, 0);

  const [numSeeds, setNumSeeds] = useState(() => savedSeedCount(participants));
  const [seeds, setSeeds]       = useState<SeedEntry[]>(participants.map(p => ({ ...p })));
  const [seeding, setSeeding]   = useState(() => savedSeedCount(participants) > 0);
  const [saving, setSaving]     = useState(false);

  const getSba  = (s: SeedEntry) => {
    const ids = (s.sbaIds?.length ? s.sbaIds : s.sbaId ? [s.sbaId] : []).map(id => id.toUpperCase());
    if (ids.length === 1) return sbaRankings.find(r => r.player1.sbaId.toUpperCase() === ids[0] && !r.player2) ?? null;
    const set = new Set(ids);
    return sbaRankings.find(r => r.player2 && set.has(r.player1.sbaId.toUpperCase()) && set.has(r.player2.sbaId.toUpperCase())) ?? null;
  };

  const entryDisplay = (s: SeedEntry) => {
    return getEntryDisplay({ teamMode: s.teamMode, club: s.club, participants: s.participants });
  };

  useEffect(() => {
    const savedCount = savedSeedCount(participants);
    setSeeds(participants.map(p => ({ ...p })));
    setNumSeeds(savedCount);
    setSeeding(savedCount > 0);
  }, [participants]);

  const autoSeed = () => {
    const withSba = seeds.filter(s => getSba(s));
    if (!withSba.length) { toastError("No participants have a registered SBA ID. Assign seeds manually."); return; }
    const canAssign = Math.min(numSeeds, withSba.length);
    const sorted = [...withSba].sort((a, b) => (getSba(b)?.accumulatedScore ?? 0) - (getSba(a)?.accumulatedScore ?? 0));
    setSeeds([...seeds.map(s => { const rank = sorted.findIndex(x => x.id === s.id); return { ...s, seed: rank >= 0 && rank < canAssign ? rank + 1 : null }; })].sort((a, b) => {
      if (a.seed !== null && b.seed !== null) return a.seed - b.seed;
      if (a.seed !== null) return -1;
      if (b.seed !== null) return 1;
      return a.club.localeCompare(b.club);
    }));
    if (canAssign < numSeeds) toastError(`Only ${canAssign}/${numSeeds} seeds auto-assigned - ${numSeeds - canAssign} participants have no SBA ID.`);
  };

  const setSeedVal = (id: string, v: string) => setSeeds(seeds.map(s => s.id === id ? { ...s, seed: v === '' ? null : +v } : s));
  const seedNums = seeds.filter(s => s.seed !== null).map(s => s.seed as number);
  const hasDups  = seedNums.length !== new Set(seedNums).size;
  const outRange = seedNums.some(n => n < 1 || n > numSeeds);
  const hasChange = seeds.some(s => {
    const original = participants.find(p => p.id === s.id);
    return s.seed !== (original?.seed ?? null);
  });

  const persistSeeds = async (exportAfter: boolean) => {
    if (hasDups || outRange || saving) return;
    setSaving(true);
    try {
      for (const seed of seeds) {
        if (!seed.registrationId || !seed.groupId) continue;
        const original = participants.find(p => p.id === seed.id)?.seed ?? null;
        if (seed.seed === original) continue;
        const result = await apiUpdateGroupSeed(seed.registrationId, seed.groupId, seed.seed);
        if (result.error) {
          toastError(result.error.message);
          return;
        }
      }
      await onSeedsSaved();
      toastSuccess('Seeds saved.');
      if (exportAfter) await onExport();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-4" style={{ border: '1px solid var(--color-table-border)', backgroundColor: 'var(--color-row-hover)' }}>
        <p className="font-bold text-sm mb-1">External Tournament Mode</p>
        <p className="text-xs opacity-60">Assign seeds then export the participant list for your external system.</p>
      </div>

      {!seeding ? (
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs font-semibold mb-2 opacity-60">Number of Seeds</label>
            <select className="field-input w-52" value={numSeeds} onChange={e => setNumSeeds(+e.target.value)}>
              <option value={0}>No seeding</option>
              {Array.from({ length: Math.min(participants.length, 8) }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>Top {n} seed{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            {numSeeds > 0 && (
              <button onClick={() => setSeeding(true)} className="btn-primary px-5 py-2.5 text-sm font-semibold">
                Assign Seeds
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs font-semibold">{seeds.filter(s => s.seed !== null).length}/{numSeeds} seeds assigned</span>
          <div className="flex flex-wrap gap-2">
            <button onClick={autoSeed} className="btn-outline flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold">
              <Shuffle className="h-3.5 w-3.5" /> Auto-fill
            </button>
            <button onClick={() => setSeeding(false)} className="btn-outline px-4 py-2.5 text-sm font-semibold">Change seed count</button>
            <button disabled={hasDups || outRange || saving || !hasChange} onClick={() => persistSeeds(false)}
              className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : "Save Seeds"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {seeding && (
          <>
            {(hasDups || outRange) && (
              <p className="text-xs px-3 py-2 font-semibold" style={{ backgroundColor: 'var(--badge-closed-bg)', color: 'var(--badge-closed-text)' }}>
                {hasDups ? 'Duplicate seed numbers.' : ''}
                {outRange ? `${hasDups ? ' ' : ''}Seeds must be between 1 and ${numSeeds}.` : ''}
              </p>
            )}
          </>
        )}
        <div className="overflow-auto" style={{ border: '1px solid var(--color-table-border)', maxHeight: 360 }}>
          <table className="trs-table" style={{ tableLayout: 'fixed', minWidth: isBadminton ? 760 : 520 }}>
            <thead style={{ position: 'sticky', top: 0 }}>
              <tr>
                <th>Entry</th>
                {isBadminton && <th style={{ width: 110 }}>SBA ID</th>}
                {isBadminton && <th style={{ width: 110 }}>SBA Score</th>}
                <th style={{ width: 96, textAlign: 'center' }}>Seed</th>
              </tr>
            </thead>
            <tbody>
              {seeds.map(s => {
                const sba = getSba(s); const isDup = seeding && s.seed !== null && seeds.filter(x => x.seed === s.seed).length > 1;
                const entry = entryDisplay(s);
                return (
                  <tr key={s.id} style={isDup ? { backgroundColor: 'var(--badge-closed-bg)' } : undefined}>
                    <td>
                      <span className="font-medium text-sm">{entry.main}</span>
                      {entry.sub && <div className="text-xs opacity-50">{entry.sub}</div>}
                    </td>
                    {isBadminton && <td className="font-mono text-xs whitespace-nowrap">{s.sbaId || <span className="opacity-45 italic">No SBA ID</span>}</td>}
                    {isBadminton && <td className="text-right font-mono text-xs whitespace-nowrap">{sba ? <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{sba.accumulatedScore.toLocaleString()}</span> : <span className="opacity-45">-</span>}</td>}
                    <td>
                      {seeding ? (
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={1} max={numSeeds} className="field-input py-1 text-sm text-center"
                            style={{
                              width: '4rem',
                              minHeight: '2.25rem',
                              backgroundColor: 'var(--color-card-bg)',
                              borderColor: isDup ? 'var(--badge-closed-text)' : 'var(--color-primary)',
                              color: 'var(--color-body-text)',
                              fontWeight: 700,
                            }}
                            value={s.seed ?? ''} placeholder="-" onChange={e => setSeedVal(s.id, e.target.value)} />
                          {s.seed !== null && <button onClick={() => setSeedVal(s.id, '')} className="text-xs opacity-30 hover:opacity-70">x</button>}
                        </div>
                      ) : (
                        <span className="block text-center text-xs opacity-45">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
    </div>
  );
}


// Main page


export default function AdminFixtures() {
  const [allEvents,          setAllEvents]          = useState<TournamentEvent[]>([]);
  const [sbaRankings,        setSbaRankings]        = useState<SbaRanking[]>([]);
  const [fixtureExists,      setFixtureExists]      = useState<Record<string, boolean>>({});
  const [selRowParticipants, setSelRowParticipants] = useState<SeedEntry[]>([]);

  // Load events from real API on mount
  useEffect(() => {
    apiGetEvents({ includeInactive: false }).then(async r => {
      if (r.error) {
        setFeedback({ open: true, variant: "error", title: "Fixtures could not be loaded", description: r.error.message });
        return;
      }
      const evs = (r.data ?? []).filter(e => e.isSports);
      setAllEvents(evs);
  // Bulk-check which programs already have a fixture in the DB
      const progIds = evs.flatMap(e => e.programs.map(p => p.id));
      if (progIds.length > 0) {
        const fxR = await apiGetFixtureStatus(progIds);
        if (fxR.data) setFixtureExists(fxR.data);
        else if (fxR.error) setFeedback({ open: true, variant: "error", title: "Fixture status could not be loaded", description: fxR.error.message });
      }
    }).catch(() => setFeedback({
      open: true,
      variant: "error",
      title: "Fixtures could not be loaded",
      description: "Please check your connection and try again.",
    }));
  }, []);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });
  const showFeedback = useCallback((variant: ActionFeedbackVariant, title: string, description?: string) => {
    setFeedback({ open: true, variant, title, description });
  }, []);
  const feedbackApi = useMemo(() => ({
    success: (message: string) => showFeedback("success", message),
    error: (message: string) => showFeedback("error", "Action could not be completed", message),
  }), [showFeedback]);

  // Build flat program rows
  const allRows: ProgramRow[] = useMemo(() =>
    allEvents.flatMap(ev =>
      ev.programs.map(p => ({
        eventId:      ev.id,
        eventName:    ev.name,
        programId:    p.id,
        programName:  p.name,
        sbaRankingType: p.sbaRankingType,
        mode:         ev.fixtureMode,
        sportType:    ev.sportType,
        startDate:    ev.eventStartDate,
        endDate:      ev.eventEndDate,
        closeDate:    ev.closeDate,
        teamMode:     p.teamMode ?? false,
        participants: (p.participantSeeds ?? []) as SeedEntry[],
      }))
    ), [allEvents]
  );

  //  Filters
  const [filterName, setFilterName] = useState("");
  const [filterMode, setFilterMode] = useState<"" | "internal" | "external" | "not_required">("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo,   setFilterTo]   = useState("");

  const filtered = useMemo(() => allRows.filter(r => {
    if (filterName && !r.eventName.toLowerCase().includes(filterName.toLowerCase()) &&
                      !r.programName.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterMode && r.mode !== filterMode) return false;
    if (filterFrom && r.startDate < filterFrom) return false;
    if (filterTo   && r.endDate   > filterTo)   return false;
    return true;
  }), [allRows, filterName, filterMode, filterFrom, filterTo]);

  const hasFilters = filterName || filterMode || filterFrom || filterTo;

  //  Selected program
  const [selRow,       setSelRow]       = useState<ProgramRow | null>(null);
  const [bracketState, setBracketState] = useState<BracketState | null>(null);
  const [showWizard,   setShowWizard]   = useState(false);
  const [activeTab,    setActiveTab]    = useState<Tab>("draw");
  const [loading,      setLoading]      = useState(false);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetLatestRoundConfirmOpen, setResetLatestRoundConfirmOpen] = useState(false);
  const [clearResultConfirmOpen, setClearResultConfirmOpen] = useState(false);
  const [generateConfirmOpen, setGenerateConfirmOpen] = useState(false);
  const [pendingWizardResult, setPendingWizardResult] = useState<WizardResult | null>(null);

  //  Score modal
  const [scoreModal, setScoreModal] = useState<MatchEntry | null>(null);
  const [draft,      setDraft]      = useState<MatchEntry | null>(null);

  //  Derived
  const isBadminton  = selRow?.sportType?.toLowerCase() === "badminton";
  const locked       = bracketState ? isBracketLocked(bracketState) : false;
  const koMatches    = bracketState?.matches ?? [];
  const maxKoRound   = koMatches.length ? Math.max(...koMatches.map(m => m.round)) : 0;
  const currKoRound  = koMatches.filter(m => m.round === maxKoRound);
  const koRoundDone  = currKoRound.length > 0 && currKoRound.every(isResolvedMatch);
  const canNextRound = koRoundDone && currKoRound.length > 1;
  const isGroupKo    = bracketState?.format === "group_knockout";
  const groupsDone   = isGroupKo && bracketState ? isPhaseComplete(bracketState) && bracketState.phase === "group" : false;
  const showNextRound = groupsDone || canNextRound;
  const showResetLatestRound = !!bracketState && bracketState.phase === "knockout" && maxKoRound > 1;
  const canResetLatestRound = showResetLatestRound && currKoRound.every(m => !hasEnteredResult(m));
  const isHeats      = bracketState?.format === "heats";

  //  Helpers
  const apiErr = (e: ApiError | null) => { if (e) feedbackApi.error(e.message); };
  const withLoading = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setLoading(true); try { return await fn(); } finally { setLoading(false); }
  };

  //  Load bracket when row selected
  useEffect(() => {
    if (!selRow) { setBracketState(null); return; }
    let cancelled = false;
    apiGetFixture(selRow.eventId, selRow.programId).then(r => {
      if (cancelled) return;
      if (r.error) {
        feedbackApi.error(r.error.message);
        setBracketState(null);
        return;
      }
      setBracketState(r.data ?? null);
      if (r.data) setActiveTab(r.data.format === "heats" ? "heats" : "draw");
    }).catch(() => {
      if (!cancelled) feedbackApi.error("Fixture could not be loaded. Please check your connection and try again.");
    });
    return () => { cancelled = true; };
  }, [selRow?.eventId, selRow?.programId, feedbackApi]);

  useEffect(() => {
    if (!selRow?.sbaRankingType) { setSbaRankings([]); return; }
    apiGetSbaRankings({ type: selRow.sbaRankingType }).then(r => {
      if (r.data) setSbaRankings(r.data);
      else if (r.error) feedbackApi.error(r.error.message);
    }).catch(() => feedbackApi.error("SBA rankings could not be loaded. Please check your connection and try again."));
  }, [selRow?.sbaRankingType, feedbackApi]);

  // Load confirmed participant groups from registrations API when a program row is selected.
  // The event API always returns participantSeeds = [] - real seeds live in registrations.
  const loadSelectedProgramParticipants = useCallback(async (row: ProgramRow) => {
    setLoadingParticipants(true);
    try {
      const r = await apiGetRegistrations(
        { eventId: row.eventId, programId: row.programId },
        { page: 1, pageSize: 500 },
      );
      if (r.error) { feedbackApi.error(r.error.message); return; }
      if (!r.data) return;
      const allGroups = r.data.items.flatMap(reg =>
        reg.groups.filter(g => g.programId === row.programId)
      );
      setSelRowParticipants(groupsToSeedEntries(allGroups).map(seed => ({ ...seed, teamMode: row.teamMode })));
    } catch {
      feedbackApi.error("Participants could not be loaded. Please check your connection and try again.");
    } finally {
      setLoadingParticipants(false);
    }
  }, [feedbackApi]);

  useEffect(() => {
    if (!selRow) { setSelRowParticipants([]); return; }
    loadSelectedProgramParticipants(selRow);
  }, [selRow, loadSelectedProgramParticipants]);


  //  Bracket cached results display in table - refresh on save
  // refreshTable re-fetches fixture existence so badges update immediately after actions
  const refreshTable = useCallback(() => {
    const progIds = allEvents.flatMap(e => e.programs.map(p => p.id));
    if (progIds.length > 0) {
      apiGetFixtureStatus(progIds).then(r => {
        if (r.data) setFixtureExists(r.data);
        else if (r.error) feedbackApi.error(r.error.message);
      }).catch(() => feedbackApi.error("Fixture status could not be refreshed."));
    }
  }, [allEvents, feedbackApi]);

  //  Wizard complete
  const handleWizardComplete = (result: WizardResult) => {
    setPendingWizardResult(result);
    setGenerateConfirmOpen(true);
  };

  const executeFixtureGeneration = async () => {
    if (!selRow || !pendingWizardResult) return;
    const { config: wizConfig, seeds, bracket: prebuilt } = pendingWizardResult;
    const result = await withLoading(() => apiGenerateDraw(selRow.eventId, selRow.programId, seeds, wizConfig, prebuilt));
    if (result.error) { apiErr(result.error); return; }
    setBracketState(result.data!);
    setShowWizard(false);
    setGenerateConfirmOpen(false);
    setPendingWizardResult(null);
    setActiveTab(wizConfig.format === "heats" ? "heats" : "draw");
    setFixtureExists(prev => ({ ...prev, [selRow.programId]: true }));
    refreshTable();
    feedbackApi.success("Fixture saved. Program registration is now closed.");
  };

  //  Reset
  const handleReset = async () => {
    if (!selRow) return;
    await withLoading(() => apiResetFixture(selRow.eventId, selRow.programId));
    setResetConfirmOpen(false);
    setBracketState(null); setShowWizard(false); setFixtureExists(prev => ({ ...prev, [selRow.programId]: false })); refreshTable(); feedbackApi.success("Fixture reset.");
  };

  //  Next round
  const handleNextRound = async () => {
    if (!selRow) return;
    const result = groupsDone
      ? await withLoading(() => apiAdvanceToKnockout(selRow.eventId, selRow.programId))
      : await withLoading(() => apiAdvanceKnockoutRound(selRow.eventId, selRow.programId));
    if (result.error) { apiErr(result.error); return; }
    setBracketState(result.data!);
    if (groupsDone) setActiveTab("draw");
    feedbackApi.success(groupsDone ? "Knockout phase generated." : "Next round generated.");
  };

  const handleResetLatestRound = async () => {
    if (!selRow) return;
    const result = await withLoading(() => apiResetLatestKnockoutRound(selRow.eventId, selRow.programId));
    if (result.error) { apiErr(result.error); return; }
    setResetLatestRoundConfirmOpen(false);
    setBracketState(result.data!);
    setActiveTab("draw");
    refreshTable();
    feedbackApi.success("Latest round reset.");
  };

  //  Score modal
  const openScore  = (m: MatchEntry) => {
    const isBye = m.team1.label === "BYE" || m.team2.label === "BYE"
      || m.team1.id.startsWith("bye-") || m.team2.id.startsWith("bye-");
    if (isBye) { feedbackApi.error("BYE match has no score to enter."); return; }
    setDraft({ ...m, games: m.games.map(g => ({ ...g })) });
    setScoreModal(m);
  };
  const closeScore = () => { setScoreModal(null); setDraft(null); };
  const saveScore  = async (currentDraft?: MatchEntry) => {
    const scoreDraft = currentDraft ?? draft;
    if (!scoreDraft || !selRow) return;
    setLoading(true);
    try {
      const scheduleResult = await apiUpdateSchedule(selRow.eventId, selRow.programId, scoreDraft.id, {
        courtNo: scoreDraft.courtNo,
        matchDate: scoreDraft.matchDate,
        startTime: scoreDraft.startTime,
        endTime: scoreDraft.endTime,
      });
      if (scheduleResult.error) { apiErr(scheduleResult.error); return; }

      const result = await apiSaveScore(selRow.eventId, selRow.programId, scoreDraft.id, {
        games: scoreDraft.games, winner: scoreDraft.walkover ? null : scoreDraft.winner,
        walkover: scoreDraft.walkover, walkoverWinner: scoreDraft.walkoverWinner, officials: scoreDraft.officials,
        remark: scoreDraft.remark ?? "",
        startTime: scoreDraft.startTime,
        endTime: scoreDraft.endTime,
      });
      if (result.error) { apiErr(result.error); return; }
      setBracketState(result.data!); refreshTable(); closeScore();
    } finally {
      setLoading(false);
    }
  };
  const clearScore = async () => {
    if (!draft || !selRow) return;
    const result = await withLoading(() => apiClearScore(selRow.eventId, selRow.programId, draft.id));
    if (result.error) { apiErr(result.error); return; }
    setClearResultConfirmOpen(false);
    setBracketState(result.data!);
    refreshTable();
    closeScore();
    feedbackApi.success("Result cleared.");
  };

  //  Schedule update
  const handleUpdateSchedule = async (matchId: string, s: { courtNo: string; matchDate: string; startTime: string; endTime: string }) => {
    if (!selRow) return;
    const result = await apiUpdateSchedule(selRow.eventId, selRow.programId, matchId, s);
    if (result.error) { apiErr(result.error); return; }
    setBracketState(result.data!);
  };

  //  Swap
  const handleSwap = async (idA: string, idB: string) => {
    if (!selRow) return;
    const result = await apiSwapTeams(selRow.eventId, selRow.programId, idA, idB);
    if (result.error) { apiErr(result.error); return; }
    setBracketState(result.data!); feedbackApi.success("Players swapped.");
  };

  //  Heats handlers
  const handleSaveHeatResult = async (roundNumber: number, teamId: string, result: string) => {
    if (!selRow) return;
    const r = await apiSaveHeatResult(selRow.eventId, selRow.programId, roundNumber, teamId, result);
    if (r.error) { apiErr(r.error); throw new Error(r.error.message); }
    setBracketState(r.data!);
  };
  const handleAdvanceHeats = async (fromRound: number, advancingIds: string[]) => {
    if (!selRow) return;
    const r = await withLoading(() => apiAdvanceHeatsRound(selRow.eventId, selRow.programId, fromRound, advancingIds));
    if (r.error) { apiErr(r.error); return; }
    setBracketState(r.data!); refreshTable(); feedbackApi.success("Round advanced.");
  };
  const handleAssignPlaces = async (places: Record<string, number>) => {
    if (!selRow) return;
    const r = await withLoading(() => apiAssignHeatPlaces(selRow.eventId, selRow.programId, places));
    if (r.error) { apiErr(r.error); return; }
    setBracketState(r.data!); refreshTable(); feedbackApi.success("Final places saved.");
  };

  const fetchAllEventRegistrations = useCallback(async (eventId: string) => {
    const pageSize = 500;
    let page = 1;
    const items: Registration[] = [];

    while (true) {
      const result = await apiGetRegistrations({ eventId }, { page, pageSize });
      if (result.error) throw new Error(result.error.message);
      if (!result.data) break;
      items.push(...result.data.items);
      if (page >= result.data.totalPages) break;
      page += 1;
    }

    return items;
  }, []);

  const handleExportTournamentSoftwareWorkbook = useCallback(async () => {
    if (!selRow) return;
    const event = allEvents.find((item) => item.id === selRow.eventId);
    if (!event) {
      feedbackApi.error("Event not found for export.");
      return;
    }

    try {
      await withLoading(async () => {
        const [registrationsResult, rankingsResult] = await Promise.all([
          fetchAllEventRegistrations(event.id),
          apiGetSbaRankings(),
        ]);
        if (rankingsResult.error) throw new Error(rankingsResult.error.message);
        await exportTournamentSoftwareWorkbook(event, registrationsResult, rankingsResult.data ?? []);
      });
      feedbackApi.success("TournamentSoftware workbook exported.");
    } catch (error) {
      feedbackApi.error(error instanceof Error ? error.message : "Failed to export workbook.");
    }
  }, [allEvents, fetchAllEventRegistrations, selRow, feedbackApi]);

  const selectRow = (row: ProgramRow) => {
    setSelRow(row); setBracketState(null); setShowWizard(false); setActiveTab("draw");
  };
  const backToList = () => { setSelRow(null); setBracketState(null); setShowWizard(false); };

  //  Tab list
  const tabs: { key: Tab; label: string }[] = bracketState?.format === "heats"
    ? [{ key: "heats", label: "Heats" }]
    : [
        { key: "draw",     label: "Bracket View" },
        { key: "results",  label: (() => {
          const all = bracketState ? getAllMatches(bracketState) : [];
          const done = all.filter(isResolvedMatch).length;
          return `Table View${all.length ? ` (${done}/${all.length})` : ""}`;
        })() },
      ];


  // RENDER


  return (
    <div className="print:p-0">
      {loading && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "var(--overlay-backdrop-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)", padding: "16px 24px", display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600 }}>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--color-primary)" }} />
            Processing...
          </div>
        </div>
      )}
      <ActionFeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        description={feedback.description}
        onOpenChange={open => setFeedback(prev => ({ ...prev, open }))}
      />
      <div className="flex items-center justify-between mb-8 print:hidden">
        <div className="admin-page-title" style={{ marginBottom: 0 }}><h1>Fixture Management</h1></div>
      </div>


      {/* PROGRAM LIST */}

      {!selRow && (
        <div className="print:hidden">
  {/* Filter bar */}
          <div className="grid grid-cols-2 md:flex md:flex-wrap items-end gap-4 p-5 mb-6"
            style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
            <div className="flex-1 min-w-48">
              <label className="block text-xs font-semibold mb-1.5 opacity-60">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-40" />
                <input className="field-input with-left-icon w-full" placeholder="Event or program name..."
                  value={filterName} onChange={e => setFilterName(e.target.value)} />
              </div>
            </div>
            <FG label="Mode">
              <select className="field-input w-40" value={filterMode}
                onChange={e => setFilterMode(e.target.value as typeof filterMode)}>
                <option value="">All Modes</option>
                <option value="internal">Internal</option>
                <option value="external">External</option>
                <option value="not_required">Not Required</option>
              </select>
            </FG>
            <FG label="Date From">
              <input type="date" className="field-input" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
            </FG>
            <FG label="Date To">
              <input type="date" className="field-input" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
            </FG>
            {hasFilters && (
              <button onClick={() => { setFilterName(""); setFilterMode(""); setFilterFrom(""); setFilterTo(""); }}
                className="btn-outline flex items-center gap-1.5 px-3 py-2 text-xs self-end">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>

          <p className="text-xs opacity-40 mb-3">{filtered.length} program{filtered.length !== 1 ? "s" : ""}{hasFilters ? " matching filters" : ""}</p>

          <div className="hidden md:block overflow-x-auto" style={{ border: "1px solid var(--color-table-border)" }}>
            <table className="trs-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Program</th>
                  <th>Mode</th>
                  <th>Event Dates</th>
                  <th>Fixture</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-sm opacity-30">No programs match the current filters.</td></tr>
                ) : filtered.map(row => {
                  const info    = computeProgramFixtureStatus(
                    { id: row.programId, name: row.programName },
                    row.closeDate, row.mode,
                    null
                  );
                  const urgent  = info.status === "ready" || info.status === "in_progress";
                  return (
                    <tr key={`${row.eventId}-${row.programId}`}
                      style={urgent ? { borderLeft: "3px solid var(--color-primary)" } : undefined}>
                      <td>
                        <p className="font-medium text-sm">{row.eventName}</p>
                        <p className="text-xs opacity-40">{row.sportType}</p>
                      </td>
                      <td className="font-semibold text-sm">{row.programName}</td>
                      <td>
                        <span className="text-xs px-2 py-0.5 font-semibold"
                          style={{
                            backgroundColor: row.mode === "external" ? "var(--badge-soon-bg)" : row.mode === "not_required" ? "var(--color-row-hover)" : "var(--badge-open-bg)",
                            color:           row.mode === "external" ? "var(--badge-soon-text)" : row.mode === "not_required" ? "var(--color-body-text)" : "var(--badge-open-text)",
                            opacity:         row.mode === "not_required" ? 0.5 : 1,
                          }}>
                          {row.mode === "internal" ? "Internal" : row.mode === "external" ? "External" : "Not Required"}
                        </span>
                      </td>
                      <td className="text-xs opacity-60 whitespace-nowrap">{row.startDate} to {row.endDate}</td>
                      <td><DrawBadge programId={row.programId} closeDate={row.closeDate} mode={row.mode} fixtureExists={fixtureExists} /></td>
                      <td>
                        {row.mode === "not_required"
                          ? <span className="text-xs opacity-30">-</span>
                          : <button onClick={() => selectRow(row)} className="btn-primary px-4 py-1.5 text-xs font-semibold">Manage</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-sm opacity-30" style={{ border: "1px solid var(--color-table-border)" }}>
                No programs match the current filters.
              </div>
            ) : filtered.map(row => {
              const info    = computeProgramFixtureStatus(
                { id: row.programId, name: row.programName },
                row.closeDate, row.mode,
                null
              );
              const urgent  = info.status === "ready" || info.status === "in_progress";
              return (
                <div key={`${row.eventId}-${row.programId}`} className="p-4"
                  style={{
                    border: "1px solid var(--color-table-border)",
                    borderLeft: urgent ? "3px solid var(--color-primary)" : undefined,
                  }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{row.programName}</p>
                      <p className="text-xs opacity-50 truncate">{row.eventName}</p>
                      <p className="text-xs opacity-40">{row.sportType}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 font-semibold flex-shrink-0"
                      style={{
                        backgroundColor: row.mode === "external" ? "var(--badge-soon-bg)" : row.mode === "not_required" ? "var(--color-row-hover)" : "var(--badge-open-bg)",
                        color:           row.mode === "external" ? "var(--badge-soon-text)" : row.mode === "not_required" ? "var(--color-body-text)" : "var(--badge-open-text)",
                        opacity:         row.mode === "not_required" ? 0.5 : 1,
                      }}>
                      {row.mode === "internal" ? "Internal" : row.mode === "external" ? "External" : "Not Required"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                    <span className="opacity-60">{row.startDate} &rarr; {row.endDate}</span>
                    <DrawBadge programId={row.programId} closeDate={row.closeDate} mode={row.mode} fixtureExists={fixtureExists} />
                  </div>
                  {row.mode !== "not_required" && (
                    <button onClick={() => selectRow(row)} className="btn-primary mt-4 w-full px-4 py-2 text-xs font-semibold">
                      Manage
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* PROGRAM DETAIL */}

      {selRow && (
        <>
          <button onClick={backToList} className="btn-back flex items-center gap-1.5 text-xs px-3 py-1.5 mb-5 print:hidden">
            <ArrowLeft className="h-3.5 w-3.5" /> All Programs
          </button>

  {/* Program header */}
          <div className="p-5 mb-5 print:hidden"
            style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs opacity-40 mb-0.5">{selRow.eventName}</p>
                <h2 className="font-bold text-base mb-1.5">{selRow.programName}</h2>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="font-semibold px-2 py-0.5"
                    style={{
                      backgroundColor: selRow.mode === "external" ? "var(--badge-soon-bg)" : "var(--badge-open-bg)",
                      color:           selRow.mode === "external" ? "var(--badge-soon-text)" : "var(--badge-open-text)",
                    }}>
                    {selRow.mode === "internal" ? "Internal" : selRow.mode === "external" ? "External" : "Not Required"}
                  </span>
                  <span className="opacity-50">{selRow.sportType}</span>
                  <span className="opacity-30">/</span>
                  <span className="opacity-50">{selRow.startDate} to {selRow.endDate}</span>
                  <span className="opacity-30">/</span>
                  <span className="opacity-50">{selRowParticipants.length} entries</span>
                </div>
                {bracketState && (
                  <div className="mt-3 text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "var(--color-body-text)" }}>
                    Fixture type: {fixtureFormatLabel(bracketState.format)}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={selRow.mode === "external"
                    ? handleExportTournamentSoftwareWorkbook
                    : () => exportParticipantsCsv(selRow.eventName, selRow.programName, selRowParticipants, isBadminton)}
                  className="btn-outline flex items-center gap-1.5 px-4 py-2 text-xs">
                  <Download className="h-3.5 w-3.5" /> {selRow.mode === "external" ? "Export Workbook" : "Export Participants"}
                </button>
                {bracketState && !locked && (
                  <button onClick={() => setResetConfirmOpen(true)}
                    className="btn-outline px-4 py-2 text-xs font-semibold"
                    style={{ color: "var(--color-primary)", borderColor: "var(--color-primary)" }}>
                    Reset Draw
                  </button>
                )}
                {false && bracketState && showNextRound && (
                  <button onClick={handleNextRound} disabled={loading}
                    className="btn-primary px-5 py-2 text-sm font-semibold disabled:opacity-40">
                    {groupsDone ? "Generate KO Phase" : "Next Round"}
                  </button>
                )}
              </div>
            </div>
          </div>

  {/* External mode */}
          {selRow.mode === "external" && (
            <ExternalPanel
              participants={selRowParticipants} sbaRankings={sbaRankings}
              isBadminton={isBadminton}
              onSeedsSaved={() => loadSelectedProgramParticipants(selRow)}
              onExport={handleExportTournamentSoftwareWorkbook}
              toastSuccess={feedbackApi.success}
              toastError={feedbackApi.error}
            />
          )}

  {/* Internal mode */}
          {selRow.mode === "internal" && (
            <>
  {/* No fixture yet */}
              {!bracketState && !showWizard && (
                <div className="py-12 flex flex-col items-center gap-4"
                  style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                  <p className="text-sm opacity-50">No fixture generated for this program.</p>
                  {loadingParticipants ? (
                    <LoadingSpinner size="sm" label="Loading registered entries..." />
                  ) : selRowParticipants.length >= 2
                    ? <button onClick={() => setShowWizard(true)} className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold">Generate Fixture <ArrowRight className="h-4 w-4" /></button>
                    : <p className="text-xs opacity-30">Need at least 2 registered entries.</p>}
                </div>
              )}

  {/* Wizard */}
              {showWizard && !bracketState && (
                <div className="p-6">
                  <FixtureWizard
                    participants={selRowParticipants}
                    sbaRankings={sbaRankings}
                    isBadminton={isBadminton}
                    onComplete={handleWizardComplete}
                    onCancel={() => setShowWizard(false)}
                  />
                </div>
              )}

  {/* Fixture tabs */}
              {bracketState && (
                <>
                  <AdminTabs<Tab> tabs={tabs} activeKey={activeTab} onChange={setActiveTab} className="print:hidden" />

                  {showResetLatestRound && (
                    <div className="mb-5 p-4 flex flex-wrap items-center justify-between gap-3 print:hidden"
                      style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                      <div>
                        <p className="text-sm font-semibold">Latest round generated</p>
                        <p className="text-xs opacity-50">
                          {canResetLatestRound
                            ? `Round ${maxKoRound} can be reset because no result has been entered in this round.`
                            : `Round ${maxKoRound} cannot be reset after results have been entered.`}
                        </p>
                      </div>
                      <button
                        onClick={() => setResetLatestRoundConfirmOpen(true)}
                        disabled={!canResetLatestRound || loading}
                        title={canResetLatestRound ? undefined : "Cannot reset after latest-round results have been entered."}
                        className="btn-outline px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                        Reset Round {maxKoRound}
                      </button>
                    </div>
                  )}

                  {showNextRound && (
                    <div className="mb-5 p-4 flex flex-wrap items-center justify-between gap-3 print:hidden"
                      style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
                      <div>
                        <p className="text-sm font-semibold">
                          {groupsDone ? "Group phase complete" : "Current round complete"}
                        </p>
                        <p className="text-xs opacity-50">
                          {groupsDone ? "Generate the knockout bracket from group standings." : "Generate the next knockout round."}
                        </p>
                      </div>
                      <button onClick={handleNextRound} disabled={loading}
                        className="btn-primary px-5 py-2 text-sm font-semibold disabled:opacity-40">
                        {groupsDone ? "Generate KO Phase" : "Next Round"}
                      </button>
                    </div>
                  )}

                  {activeTab === "draw" && (
                    <DrawTab bracketState={bracketState} eventName={selRow.eventName} programName={selRow.programName}
                      onOpenScore={openScore} onSwap={handleSwap} />
                  )}
                  {activeTab === "results" && (
                    <ResultsTab bracketState={bracketState} eventName={selRow.eventName} programName={selRow.programName}
                      onUpdateSchedule={handleUpdateSchedule} onOpenScore={openScore} />
                  )}
                  {activeTab === "heats" && (
                    <HeatsTab bracketState={bracketState} eventName={selRow.eventName} programName={selRow.programName}
                      onSaveResult={handleSaveHeatResult} onAdvanceRound={handleAdvanceHeats}
                      onAssignPlaces={handleAssignPlaces} />
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      <ScoreModal open={!!scoreModal} draft={draft} isLocked={locked}
        onClose={closeScore} onSave={saveScore}
        onClear={() => setClearResultConfirmOpen(true)}
        onChangeDraft={patch => setDraft(prev => prev ? { ...prev, ...patch } : prev)} />
      <ConfirmDialog
        open={generateConfirmOpen}
        onOpenChange={setGenerateConfirmOpen}
        title="Generate Fixture"
        description="Generating this fixture will close the selected program to stop further registrations."
        confirmLabel="Proceed"
        loading={loading}
        onConfirm={executeFixtureGeneration}
      />
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset Fixture"
        description="Reset this fixture? All match data will be lost."
        confirmLabel="Reset Fixture"
        loading={loading}
        destructive
        onConfirm={handleReset}
      />
      <ConfirmDialog
        open={resetLatestRoundConfirmOpen}
        onOpenChange={setResetLatestRoundConfirmOpen}
        title={`Reset Round ${maxKoRound}`}
        description={`Reset round ${maxKoRound}? This removes only the latest generated round and keeps earlier round results.`}
        confirmLabel={`Reset Round ${maxKoRound}`}
        loading={loading}
        destructive
        onConfirm={handleResetLatestRound}
      />
      <ConfirmDialog
        open={clearResultConfirmOpen}
        onOpenChange={setClearResultConfirmOpen}
        title="Clear Result"
        description="Clear this match result? The match will return to Scheduled and can be entered again."
        confirmLabel="Clear Result"
        loading={loading}
        destructive
        onConfirm={clearScore}
      />
    </div>
  );
}
