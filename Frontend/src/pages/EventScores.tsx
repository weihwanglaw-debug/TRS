import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Radio } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ScoreMatches from "@/components/events/ScoreMatches";
import { getLiveScores, getProgramResults, getScoreAvailability, type LiveScores, type ProgramResults } from "@/lib/api/scoresApi";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { formatConfiguredDateTime } from "@/lib/dateTime";
import "./event-scores.css";

const roundKey = (m: { phase: string; round: number; roundLabel: string }) =>
  m.phase === "G" ? "G" : `K${m.round}:${m.roundLabel}`;

export default function EventScores({ live = false }: { live?: boolean }) {
  const { id = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const program = search.get("program") || "";
  const [data, setData] = useState<LiveScores | ProgramResults>();
  const [error, setError] = useState("");
  const [hasResults, setHasResults] = useState(false);
  const [matchDate, setMatchDate] = useState("");
  const [round, setRound] = useState("");
  const [fetchedAt, setFetchedAt] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const { cfg } = useLiveConfig();
  useEffect(() => {
    let stopped = false, loading = false, refreshRequested = false;
    let request: AbortController | undefined, timer: ReturnType<typeof setTimeout>;
    let interval = 5;
    setHasResults(false); setData(undefined); setError(""); setRound(""); setMatchDate(""); setFetchedAt(undefined);
    const pageIsHidden = () => document.visibilityState === "hidden";
    async function load() {
      if (stopped || pageIsHidden()) return;
      clearTimeout(timer);
      if (loading) { refreshRequested = true; return; }
      loading = true; refreshRequested = false;
      const controller = new AbortController(); request = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const next = live ? await getLiveScores(id, controller.signal) : await getProgramResults(id, program, controller.signal);
        if (stopped || controller.signal.aborted) return;
        setData(next); setError(""); setFetchedAt(new Date().toISOString()); setNow(Date.now());
        if ("refreshSeconds" in next) interval = Math.min(120, Math.max(2, next.refreshSeconds));
        if (live) {
          try {
            const availability = await getScoreAvailability(id, controller.signal);
            if (!stopped && !controller.signal.aborted) setHasResults(availability.hasResults ?? availability.resultProgramIds.length > 0);
          } catch { /* Availability failures must not interrupt live-score refreshes. */ }
        }
      } catch (e) {
        if (!stopped) setError(controller.signal.aborted ? "Unable to refresh scores. Retrying automatically." : (e as Error).message);
      } finally {
        clearTimeout(timeout); loading = false;
        if (!stopped && !pageIsHidden()) {
          if (refreshRequested) void load();
          else timer = setTimeout(load, interval * 1000);
        }
      }
    }
    function refresh() { void load(); }
    function visibilityChanged() {
      if (document.visibilityState === "hidden") { clearTimeout(timer); refreshRequested = false; }
      else refresh();
    }
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visibilityChanged);
    void load();
    return () => {
      stopped = true; request?.abort(); clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [id, program, live]);
  const activeLive = live && data?.matches.some(m => m.status === "IP" || m.status === "RC" || m.gamePhase === "WU");
  useEffect(() => {
    if (!activeLive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeLive]);
  const receivedAt = Date.parse(data?.receivedAt || "");
  const liveInterval = data && "refreshSeconds" in data ? Math.min(120, Math.max(2, data.refreshSeconds)) : 5;
  const feedDelayed = activeLive && (!Number.isFinite(receivedAt) || now - receivedAt >= Math.max(15, 3 * liveInterval) * 1000);
  const results = data && "programs" in data ? data : undefined;
  const dates = [...new Set(data?.matches.map(m => m.matchDate).filter(Boolean) ?? [])].sort();
  const dateMatches = (data?.matches ?? []).filter(m => !matchDate || m.matchDate === matchDate);
  const rounds = [...new Map(dateMatches.map(m => [m.phase === "G" ? "G" : `K${m.round}`, { key: roundKey(m), label: m.phase === "G" ? "Group Stage" : m.roundLabel || `Round ${m.round}`, order: m.phase === "G" ? 0 : m.round }])).values()].sort((a, b) => a.order - b.order);
  const selected = rounds.some(r => r.key === round) ? round : rounds[0]?.key;
  const matches = live ? data?.matches || [] : dateMatches.filter(m => roundKey(m) === selected);
  const courts = [...new Set(matches.map(m => m.court))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const displayedPrograms = results?.programs.filter(p =>
    matches.some(m => m.programId === p.id) || results.heats.some(h => h.programId === p.id)) ?? [];
  const timestamp = (value: string | null | undefined) => formatConfiguredDateTime(value, cfg.displayTimeZone, cfg.displayDateTimeFormat, "—");
  return <div className="landing-shell min-h-screen flex flex-col public-scores-shell"><Header /><main className="public-scores-main flex-1"><section className="landing-section white public-scores-section"><div className="landing-section-inner">
    <div className="public-scores-header"><div>
      <p className="landing-section-label public-scores-kicker">Tournament /</p>
      <h1 className="landing-section-title public-scores-title">{live ? "Live Scores" : "Results"}</h1>
      {data && <h2 className="public-scores-event">{data.eventName}</h2>}
    </div><div className="public-scores-actions"><Link to={`/event/${id}`} className="landing-button secondary public-scores-back"><ArrowLeft size={16} aria-hidden="true"/>Back to Event</Link>{live && hasResults && <Link to={`/event/${id}/results`} className="landing-button secondary">View Results</Link>}</div></div>
    {error && <p role="alert" className="public-scores-notice">{error}</p>}
    {feedDelayed && !error && <p role="alert" className="public-scores-notice public-scores-delayed">Live updates delayed — showing last received scores</p>}
    {!data && !error && <p className="public-scores-empty">Loading...</p>}
    {(results || live && data) && <div className="public-scores-toolbar">
    {results && <div className="trs-field public-scores-program"><label htmlFor="score-program">Program</label><select id="score-program" value={results.programId ?? ""} onChange={e => setSearch(e.target.value ? { program: e.target.value } : {})}>
      <option value="">All programs</option>
      {results.programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></div>}
    {results && dates.length > 0 && <div className="trs-field public-scores-program"><label htmlFor="score-date">Match date</label><select id="score-date" value={matchDate} onChange={e => { setMatchDate(e.target.value); setRound(""); }}>
      <option value="">All dates</option>
      {dates.map(date => <option key={date} value={date}>{date}</option>)}
    </select></div>}
    {results && <p className="public-scores-refresh"><Radio size={16} aria-hidden="true"/>Refreshes every 5 seconds</p>}
    {live && data && <><p className="public-scores-refresh"><Radio size={16} aria-hidden="true"/>Refreshes every {"refreshSeconds" in data ? data.refreshSeconds : 5} seconds</p><dl className="public-scores-timestamps">
      <div><dt>Last fetched</dt><dd data-testid="last-fetched">{timestamp(fetchedAt)}</dd></div>
      <div><dt>Last received from TLS</dt><dd data-testid="last-received">{timestamp(data.receivedAt)}</dd></div>
    </dl></>}
    {!live && data?.receivedAt && <p className="public-scores-received">{results?.source === "TRS" ? "Last published" : "Last received from TLS"}: {timestamp(data.receivedAt)}</p>}
    </div>}
    {!live && rounds.length > 0 && <div role="tablist" aria-label="Rounds" className="public-scores-tabs">
      {rounds.map(r => <button key={r.key} role="tab" aria-selected={selected === r.key} className="public-scores-tab" onClick={() => setRound(r.key)}>{r.label}</button>)}
    </div>}
    {data && !matches.length && !results?.heats.length && <p className="public-scores-empty">{live ? "No matches currently in progress." : "Results are not available yet."}</p>}
    {live ? courts.map(court => <section key={court} aria-label={court ? `Court ${court}` : "Court not assigned"}>
      <h3 className="public-scores-event">{court ? `Court ${court}` : "Court not assigned"}</h3>
      <ScoreMatches matches={matches.filter(match => match.court === court)} live now={now} />
    </section>) : results?.programId == null && displayedPrograms.length > 0
      ? displayedPrograms.map(program => <section key={program.id}>
          <h3 className="public-scores-event">{program.name}</h3>
          <ScoreMatches matches={matches.filter(match => match.programId === program.id)} />
        </section>)
      : <ScoreMatches matches={matches} />}
    {results?.heats.map(h => <section key={`${h.programId}-${h.roundNumber}`} className="public-score-card public-scores-heat"><h3>{results.programId == null && h.programId ? `${results.programs.find(p => p.id === h.programId)?.name ?? ""} · ` : ""}{h.label}</h3><table className="w-full text-left"><thead><tr><th>Entry</th><th>Result</th><th>Place</th></tr></thead><tbody>{h.results.map((r, i) => <tr key={i}><td className="py-2">{r.name}</td><td>{r.result}</td><td>{r.place ?? (r.advanced ? "Qualified" : "—")}</td></tr>)}</tbody></table></section>)}
  </div></section></main><Footer /></div>;
}
