/**
 * fixtureEngine.ts
 * Pure bracket-generation and standings functions.
 * No React, no side effects.
 *
 * Formats: knockout | group_knockout | round_robin | heats
 */

import type {
  FixtureFormat, FixtureFormatConfig, TiebreakCriteria,
  SeedEntry, TeamEntry, MatchEntry, MatchPhase,
  GroupEntry, GroupStanding, BracketState,
  HeatRound, HeatParticipantResult,
} from "@/types/config";

// ── ID generation ─────────────────────────────────────────────────────────────

function makeIdGen(startAt = 0) {
  let seq = startAt;
  return (prefix: string) => `${prefix}-${String(++seq).padStart(4, "0")}`;
}
function parseSeq(id: string): number {
  const n = parseInt(id.split("-").pop() ?? "0", 10);
  return isNaN(n) ? 0 : n;
}
function maxSeqFrom(matches: MatchEntry[]): number {
  return matches.reduce((max, m) => Math.max(max, parseSeq(m.id)), 0);
}

// ── Blank match factory ───────────────────────────────────────────────────────

function blankMatch(
  nextId: ReturnType<typeof makeIdGen>,
  team1: TeamEntry, team2: TeamEntry,
  round: number, phase: MatchPhase,
  extras: Partial<MatchEntry> = {}
): MatchEntry {
  return {
    id: nextId("M"), phase, round, roundLabel: "",
    team1, team2,
    games: [{ p1: "", p2: "" }],
    winner: null, walkover: false, walkoverWinner: "",
    matchDate: "", startTime: "", endTime: "", courtNo: "",
    officials: [], status: "Scheduled", expanded: false,
    ...extras,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getRoundLabel(matchesInRound: number): string {
  switch (matchesInRound) {
    case 1:  return "Final";
    case 2:  return "Semi-Final";
    case 4:  return "Quarter-Final";
    default: return `Round of ${matchesInRound * 2}`;
  }
}

function applyRoundLabels(matches: MatchEntry[]): MatchEntry[] {
  const rounds = [...new Set(matches.map(m => m.round))].sort((a, b) => a - b);
  const lastRound = rounds[rounds.length - 1];
  return matches.map(m => {
    if (m.phase !== "knockout") return m;
    const inRound = matches.filter(x => x.round === m.round && x.phase === "knockout").length;
    return {
      ...m,
      roundLabel: m.round === lastRound && inRound === 1
        ? "Final"
        : getRoundLabel(inRound),
    };
  });
}

function pts(v: string): number { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function seedToTeam(s: SeedEntry): TeamEntry {
  return { id: s.id, label: s.club, participants: s.participants, seed: s.seed ?? undefined };
}

function sortedSeeds(seeds: SeedEntry[]): SeedEntry[] {
  const seeded   = seeds.filter(s => s.seed !== null).sort((a, b) => (a.seed as number) - (b.seed as number));
  const unseeded = seeds.filter(s => s.seed === null).sort(() => Math.random() - 0.5);
  return [...seeded, ...unseeded];
}

// ── Knockout bracket ──────────────────────────────────────────────────────────

function nextPow2(n: number): number {
  let p = 1; while (p < n) p *= 2; return p;
}

function generateKnockoutMatches(
  nextId: ReturnType<typeof makeIdGen>,
  teams: TeamEntry[]
): MatchEntry[] {
  const n   = teams.length;
  const pow = nextPow2(n);
  const byes = pow - n;
  const byeTeam = (): TeamEntry => ({ id: `bye-${Math.random().toString(36).slice(2)}`, label: "BYE", participants: [] });

  // Snake seeding: seed 1 top-left, seed 2 bottom-right, seed 3 bottom-left, seed 4 top-right...
  const slots: (TeamEntry | null)[] = Array(pow).fill(null);
  const seedOrder = [0, pow - 1, pow / 2 - 1, pow / 2];
  teams.forEach((t, i) => {
    const pos = i < seedOrder.length ? seedOrder[i] : -1;
    if (pos !== -1 && slots[pos] === null) slots[pos] = t;
    else {
      const empty = slots.findIndex((s, idx) => s === null && !seedOrder.slice(0, i).includes(idx));
      slots[empty === -1 ? slots.findIndex(s => s === null) : empty] = t;
    }
  });

  // Pair slots for round 1
  const matches: MatchEntry[] = [];
  for (let i = 0; i < pow; i += 2) {
    const t1 = slots[i] ?? byeTeam();
    const t2 = slots[i + 1] ?? byeTeam();
    matches.push(blankMatch(nextId, t1, t2, 1, "knockout"));
  }
  return applyRoundLabels(matches);
}

// ── Group draw ────────────────────────────────────────────────────────────────

function generateGroupDraw(
  nextId: ReturnType<typeof makeIdGen>,
  seeds: SeedEntry[],
  numGroups: number
): GroupEntry[] {
  const sorted = sortedSeeds(seeds);
  const groups: GroupEntry[] = Array.from({ length: numGroups }, (_, i) => ({
    id: `G${i + 1}`, name: `Group ${String.fromCharCode(65 + i)}`, teams: [], matches: [],
  }));

  // Snake distribution
  sorted.forEach((s, i) => {
    const gi = i % (numGroups * 2) < numGroups ? i % numGroups : numGroups - 1 - (i % numGroups);
    groups[gi].teams.push(seedToTeam(s));
  });

  // Round-robin matches within each group
  for (const g of groups) {
    const ts = g.teams;
    for (let a = 0; a < ts.length - 1; a++) {
      for (let b = a + 1; b < ts.length; b++) {
        g.matches.push(blankMatch(nextId, ts[a], ts[b], 1, "group", { groupId: g.id }));
      }
    }
  }
  return groups;
}

// ── Knockout from groups ──────────────────────────────────────────────────────

export function generateKnockoutFromGroups(
  groups: GroupEntry[], config: FixtureFormatConfig
): MatchEntry[] {
  const advance = config.advancePerGroup ?? 2;
  const nextId  = makeIdGen(
    maxSeqFrom(groups.flatMap(g => g.matches))
  );

  const advancers: TeamEntry[][] = groups.map(g => {
    const standings = computeGroupStandings(g);
    return standings.slice(0, advance).map(s => s.team);
  });

  const paired: [TeamEntry, TeamEntry][] = [];

  if (groups.length === 2) {
    const [a, b] = advancers;
    for (let i = 0; i < advance; i++) paired.push([a[i], b[advance - 1 - i]]);
  } else {
    for (let i = 0; i < advance; i++) {
      for (let j = 0; j < groups.length - 1; j++) {
        const t1 = advancers[j]?.[i], t2 = advancers[j + 1]?.[i];
        if (t1 && t2) paired.push([t1, t2]);
      }
    }
  }

  const matches = paired.map(([t1, t2]) => blankMatch(nextId, t1, t2, 1, "knockout"));
  return applyRoundLabels(matches);
}

// ── Next KO round ─────────────────────────────────────────────────────────────

export function generateNextKnockoutRound(koMatches: MatchEntry[]): MatchEntry[] {
  const maxRound = Math.max(...koMatches.map(m => m.round));
  const last     = koMatches.filter(m => m.round === maxRound);
  const nextId   = makeIdGen(maxSeqFrom(koMatches));

  const winners: TeamEntry[] = last.map(m =>
    m.winner === "team1" ? m.team1 : m.winner === "team2" ? m.team2 : m.team1
  );

  const newMatches: MatchEntry[] = [];
  for (let i = 0; i < winners.length - 1; i += 2) {
    newMatches.push(blankMatch(nextId, winners[i], winners[i + 1], maxRound + 1, "knockout"));
  }
  return applyRoundLabels([...koMatches, ...newMatches]).filter(m => m.round > maxRound);
}

// ── Group standings ───────────────────────────────────────────────────────────

export function computeGroupStandings(
  group: GroupEntry,
  tiebreakOrder: TiebreakCriteria[] = ["head_to_head", "game_ratio", "point_ratio"],
  pointsConfig = { win: 2, draw: 1, loss: 0 }
): GroupStanding[] {
  const map: Record<string, GroupStanding> = {};
  for (const team of group.teams) {
    map[team.id] = {
      team, played: 0, wins: 0, losses: 0, draws: 0,
      gamesFor: 0, gamesAgainst: 0, pointsFor: 0, pointsAgainst: 0,
      points: 0, rank: 0,
    };
  }

  for (const match of group.matches) {
    if (match.status !== "Completed" && match.status !== "Walkover") continue;
    const s1 = map[match.team1.id];
    const s2 = map[match.team2.id];
    if (!s1 || !s2) continue;
    s1.played++; s2.played++;
    for (const g of match.games) {
      if (g.p1 === "" || g.p2 === "") continue;
      const a = pts(g.p1), b = pts(g.p2);
      s1.pointsFor += a; s1.pointsAgainst += b;
      s2.pointsFor += b; s2.pointsAgainst += a;
      if (a > b) { s1.gamesFor++; s2.gamesAgainst++; }
      else if (b > a) { s2.gamesFor++; s1.gamesAgainst++; }
    }
    if (match.winner === "team1")      { s1.wins++; s1.points += pointsConfig.win;  s2.losses++; s2.points += pointsConfig.loss; }
    else if (match.winner === "team2") { s2.wins++; s2.points += pointsConfig.win;  s1.losses++; s1.points += pointsConfig.loss; }
    else { s1.draws++; s1.points += pointsConfig.draw; s2.draws++; s2.points += pointsConfig.draw; }
  }

  const standings = Object.values(map);
  const h2h: Record<string, Record<string, "A" | "B" | "draw">> = {};
  for (const m of group.matches) {
    if (m.status !== "Completed") continue;
    const a = m.team1.id, b = m.team2.id;
    if (!h2h[a]) h2h[a] = {}; if (!h2h[b]) h2h[b] = {};
    if (m.winner === "team1")      { h2h[a][b] = "A"; h2h[b][a] = "B"; }
    else if (m.winner === "team2") { h2h[a][b] = "B"; h2h[b][a] = "A"; }
    else { h2h[a][b] = "draw"; h2h[b][a] = "draw"; }
  }

  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (const c of tiebreakOrder) {
      let diff = 0;
      switch (c) {
        case "head_to_head": {
          const r = h2h[a.team.id]?.[b.team.id];
          if (r === "A") return -1; if (r === "B") return 1; break;
        }
        case "game_ratio":    diff = (b.gamesFor/(b.played||1)) - (a.gamesFor/(a.played||1)); break;
        case "point_ratio":   diff = (b.pointsFor/(b.pointsAgainst||1)) - (a.pointsFor/(a.pointsAgainst||1)); break;
        case "goal_difference": diff = (b.pointsFor-b.pointsAgainst) - (a.pointsFor-a.pointsAgainst); break;
        case "goals_scored":  diff = b.pointsFor - a.pointsFor; break;
      }
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return a.team.id.localeCompare(b.team.id);
  });
  standings.forEach((s, i) => { s.rank = i + 1; });
  return standings;
}

// ── Heats generation ──────────────────────────────────────────────────────────

export function generateHeatsDraw(seeds: SeedEntry[], config: FixtureFormatConfig): BracketState {
  const hc = config.heatsConfig ?? { numRounds: 2, advancePerRound: 4, resultLabel: "Result", placesAwarded: 3 };

  const heatRounds: HeatRound[] = Array.from({ length: hc.numRounds }, (_, i) => {
    const isFirst = i === 0;
    const isFinal = i === hc.numRounds - 1;
    const label   = isFinal ? "Final" : hc.numRounds === 2 ? "Heat" : i === 0 ? "Heat" : `Round ${i + 1}`;
    // Round 1 has all participants; later rounds will be populated as admin advances
    const results: HeatParticipantResult[] = isFirst
      ? seeds.map(s => ({ teamId: s.id, result: "", advanced: false }))
      : [];
    return { id: `HR-${i + 1}`, roundNumber: i + 1, label, isFinal, results, isComplete: false };
  });

  return {
    format: "heats", config,
    locked: false, phase: "knockout",
    groups: [], matches: [], seeds,
    heatRounds,
  };
}

// ── Heats: advance participants to next round ─────────────────────────────────

export function advanceHeatsRound(
  state: BracketState,
  fromRound: number,
  advancingIds: string[]
): BracketState {
  const rounds = (state.heatRounds ?? []).map(r => {
    if (r.roundNumber === fromRound) {
      return {
        ...r,
        isComplete: true,
        results: r.results.map(res => ({
          ...res,
          advanced: advancingIds.includes(res.teamId),
        })),
      };
    }
    if (r.roundNumber === fromRound + 1) {
      return {
        ...r,
        results: advancingIds.map(id => ({ teamId: id, result: "", advanced: false })),
      };
    }
    return r;
  });
  return { ...state, heatRounds: rounds };
}

// ── Heats: save result for a round participant ────────────────────────────────

export function saveHeatResult(
  state: BracketState,
  roundNumber: number,
  teamId: string,
  result: string
): BracketState {
  const rounds = (state.heatRounds ?? []).map(r => {
    if (r.roundNumber !== roundNumber) return r;
    return {
      ...r,
      results: r.results.map(res =>
        res.teamId === teamId ? { ...res, result } : res
      ),
    };
  });
  return { ...state, heatRounds: rounds };
}

// ── Heats: assign final places ────────────────────────────────────────────────

export function assignHeatPlaces(
  state: BracketState,
  places: Record<string, number>   // teamId → place number
): BracketState {
  const rounds = (state.heatRounds ?? []).map(r => {
    if (!r.isFinal) return r;
    return {
      ...r,
      isComplete: true,
      results: r.results.map(res => ({
        ...res,
        place: places[res.teamId],
        advanced: true,
      })),
    };
  });
  return { ...state, heatRounds: rounds };
}

// ── Main draw generation ──────────────────────────────────────────────────────

export function generateDraw(seeds: SeedEntry[], config: FixtureFormatConfig): BracketState {
  const nextId = makeIdGen(0);
  const { format } = config;

  if (format === "heats") return generateHeatsDraw(seeds, config);

  const base: BracketState = {
    format, config,
    locked: false, phase: "knockout",
    groups: [], matches: [], seeds,
  };

  switch (format) {
    case "knockout":
      return { ...base, matches: generateKnockoutMatches(nextId, sortedSeeds(seeds).map(seedToTeam)) };
    case "group_knockout":
      return { ...base, phase: "group", groups: generateGroupDraw(nextId, seeds, config.numGroups ?? 2) };
    case "round_robin":
      return { ...base, phase: "group", groups: generateGroupDraw(nextId, seeds, 1) };
    default:
      return base;
  }
}

// ── Swap teams ────────────────────────────────────────────────────────────────

export function swapTeams(state: BracketState, idA: string, idB: string): BracketState {
  function swapInList(matches: MatchEntry[]): MatchEntry[] {
    return matches.map(m => {
      const t1A = m.team1.id === idA, t1B = m.team1.id === idB;
      const t2A = m.team2.id === idA, t2B = m.team2.id === idB;
      if (!t1A && !t1B && !t2A && !t2B) return m;
      return {
        ...m,
        team1: t1A ? m.team2 : t1B ? m.team1 : m.team1,
        team2: t2B ? m.team1 : t2A ? m.team2 : m.team2,
      };
    });
  }
  const newSeeds = state.seeds.map(s => {
    if (s.id === idA) { const o = state.seeds.find(x => x.id === idB); return { ...s, seed: o?.seed ?? null }; }
    if (s.id === idB) { const o = state.seeds.find(x => x.id === idA); return { ...s, seed: o?.seed ?? null }; }
    return s;
  });
  // Swap in heats too
  const heatRounds = (state.heatRounds ?? []).map(r => ({
    ...r,
    results: r.results.map(res =>
      res.teamId === idA ? { ...res, teamId: idB }
      : res.teamId === idB ? { ...res, teamId: idA }
      : res
    ),
  }));
  return {
    ...state, seeds: newSeeds,
    matches: swapInList(state.matches),
    groups: state.groups.map(g => ({ ...g, matches: swapInList(g.matches) })),
    heatRounds,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function isBracketLocked(state: BracketState): boolean {
  if (state.format === "heats") {
    return (state.heatRounds ?? []).some(r => r.isComplete);
  }
  return [...state.matches, ...state.groups.flatMap(g => g.matches)]
    .some(m => m.status !== "Scheduled");
}

export function isPhaseComplete(state: BracketState): boolean {
  if (state.format === "heats") {
    const rounds = state.heatRounds ?? [];
    const current = rounds.filter(r => !r.isComplete);
    return current.length === 0;
  }
  if (state.phase === "group")
    return state.groups.every(g => g.matches.every(m => m.status === "Completed" || m.status === "Walkover"));
  return state.matches.every(m => m.status === "Completed" || m.status === "Walkover");
}

export function getAllMatches(state: BracketState): MatchEntry[] {
  return [...state.groups.flatMap(g => g.matches), ...state.matches];
}

// ── Heats utilities ───────────────────────────────────────────────────────────

export function getCurrentHeatRound(state: BracketState): HeatRound | null {
  if (state.format !== "heats") return null;
  return (state.heatRounds ?? []).find(r => !r.isComplete) ?? null;
}

export function getHeatsTeamLabel(state: BracketState, teamId: string): string {
  const seed = state.seeds.find(s => s.id === teamId);
  return seed ? seed.club : teamId;
}
